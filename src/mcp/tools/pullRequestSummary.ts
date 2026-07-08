/**
 * `get_pull_request_summary` — agent-optimised, size-bounded PR overview.
 *
 * Existing PR tools (`get_pull_request`, `list_pull_request_files`,
 * `list_pull_request_commits`, `list_pull_request_reviews`,
 * `list_issue_comments`) each return the raw SDK response, which on a large
 * PR can be tens of thousands of tokens (every file's unified-diff `patch`
 * is embedded inline, every comment body runs unbounded, the commit list
 * reaches hundreds). That overwhelms the agent's context window and forces
 * it to make N separate round-trips just to get the essentials.
 *
 * This tool fetches the PR once and returns a compact, schema-stable
 * envelope with selectable sections. By default it returns exactly what an
 * agent needs to triage a PR — description (bounded body), commits (short
 * SHA + subject only), conversation (issue comments, bounded), and a files
 * overview (counts only — NO patches). Reviews and CI status are opt-in.
 *
 * Every bounded section carries `truncated`/`total`/`returned` flags so the
 * agent knows when it should drill in with the raw tools. Use this INSTEAD
 * of calling get_pull_request + list_pull_request_commits +
 * list_issue_comments + list_pull_request_files separately.
 */

import type { PullRequest, PullRequestFile, PullRequestCommit, PullRequestReview, IssueComment } from 'forgejo-ts';
import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import { objectSchema, ownerSchema, repoSchema, numberSchema } from './schema';
import { deduplicateStatuses, summarizeStatuses } from '../utils/statusDedup';
import {
	summarizePrDescription,
	summarizeCommits,
	summarizeComments,
	summarizeFilesOverview,
	summarizeReviews,
	PrDescriptionSummary,
	CommitsSummary,
	ConversationSummary,
	FilesOverviewSummary,
	ReviewsSummary,
	DEFAULT_MAX_BODY_LENGTH,
	DEFAULT_MAX_COMMITS,
	DEFAULT_MAX_COMMENTS,
	DEFAULT_MAX_FILES,
	clampInt,
	readBool,
} from '../utils/responseFormat';
import type { CommitStatus } from 'forgejo-ts';

/** Toggle map for which sections to include. All default to false; the
 *  handler flips the four essentials to true unless explicitly disabled. */
interface SectionToggles {
	description?: boolean;
	commits?: boolean;
	conversation?: boolean;
	files_overview?: boolean;
	reviews?: boolean;
	ci_status?: boolean;
}

/** Result envelope returned by the tool. Only requested sections are set. */
export interface PullRequestSummaryResult {
	number: number;
	title: string;
	state: string;
	/** List of section keys present in this response, for quick scanning. */
	sections: string[];
	description?: PrDescriptionSummary;
	commits?: CommitsSummary;
	conversation?: ConversationSummary;
	files_overview?: FilesOverviewSummary;
	reviews?: ReviewsSummary;
	ci_status?: {
		head_sha: string;
		head_branch: string;
		summary: string;
		statuses: CommitStatus[];
	};
	_meta: {
		/** True when any included section was truncated. */
		truncated: boolean;
		/** Effective caps applied (so the agent can re-call with larger ones). */
		caps: {
			max_body_length: number;
			max_commits: number;
			max_comments: number;
			max_files: number;
			max_patch_lines: number;
		};
		/** Pointer to the raw tools for drilling in. */
		hint: string;
	};
}

/** Schema property for the nested `sections` object. */
const sectionsSchema = {
	type: 'object',
	description:
		'Which sections to include. All default to false; the handler ' +
		'enables the four essentials (description, commits, conversation, ' +
		'files_overview) unless you explicitly set one to false. Reviews ' +
		'and ci_status are opt-in — set to true to include them.',
	properties: {
		description: { type: 'boolean' },
		commits: { type: 'boolean' },
		conversation: { type: 'boolean' },
		files_overview: { type: 'boolean' },
		reviews: { type: 'boolean' },
		ci_status: { type: 'boolean' },
	},
};

export const getPullRequestSummaryTool: Tool = {
	name: 'get_pull_request_summary',
	description:
		'Fetch a size-bounded, agent-optimised summary of a pull request in ' +
		'a single call. By default returns four sections: description ' +
		'(title + bounded body + state + refs + mergeable + labels), ' +
		'commits (short SHA + subject line + author/date, capped), ' +
		'conversation (issue comments thread, bounded body + capped count), ' +
		'and files_overview (file status + additions/deletions/changes — NO ' +
		'patches by default). Set sections.reviews=true and/or ' +
		'sections.ci_status=true to add those. Every section carries ' +
		'truncated/total/returned flags so you know when to drill in. ' +
		'Use this INSTEAD of calling get_pull_request + ' +
		'list_pull_request_commits + list_issue_comments + ' +
		'list_pull_request_files separately. For full raw data on a single ' +
		'facet, call the specific tool instead.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			sections: sectionsSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters for the PR body and each comment body. Default 2000.',
			},
			max_commits: {
				type: 'integer',
				minimum: 1,
				maximum: 250,
				default: 50,
				description: 'Max number of commit items to return. Default 50.',
			},
			max_comments: {
				type: 'integer',
				minimum: 1,
				maximum: 200,
				default: 50,
				description: 'Max number of conversation comment items to return. Default 50.',
			},
			max_files: {
				type: 'integer',
				minimum: 1,
				maximum: 500,
				default: 100,
				description: 'Max number of file items in files_overview. Default 100.',
			},
			max_patch_lines: {
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 0,
				description:
					'Max patch lines to keep PER FILE in files_overview. ' +
					'0 (default) drops patches entirely — only counts are ' +
					'returned. Set >0 to keep a bounded snippet with hunk headers.',
			},
		},
		['number'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const prNumber = resolveNumber(args, 'number');

		// Resolve caps defensively (handler is the source of truth — the
		// server's validateArgs only checks top-level types, not nested
		// numeric ranges inside `sections`-like objects).
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		const maxCommits = clampInt(args.max_commits, 1, 250, DEFAULT_MAX_COMMITS);
		const maxComments = clampInt(args.max_comments, 1, 200, DEFAULT_MAX_COMMENTS);
		const maxFiles = clampInt(args.max_files, 1, 500, DEFAULT_MAX_FILES);
		const maxPatchLines = clampInt(args.max_patch_lines, 0, 1000, 0);

		// Section toggles: the four essentials default ON (true) unless the
		// caller explicitly sets one to `false`. Reviews + ci_status default
		// OFF and must be explicitly opted in.
		const rawSections = (args.sections ?? {}) as SectionToggles;
		const wantDescription = readBool(rawSections.description, true);
		const wantCommits = readBool(rawSections.commits, true);
		const wantConversation = readBool(rawSections.conversation, true);
		const wantFiles = readBool(rawSections.files_overview, true);
		const wantReviews = readBool(rawSections.reviews, false);
		const wantCi = readBool(rawSections.ci_status, false);

		// We always need the PR object — it drives description, ci_status,
		// and the head SHA used by reviews drill-in.
		const pr: PullRequest = await client.getPullRequest(owner, repo, prNumber);

		const result: PullRequestSummaryResult = {
			number: pr.number,
			title: pr.title,
			state: pr.state,
			sections: [],
			_meta: {
				truncated: false,
				caps: {
					max_body_length: maxBodyLength,
					max_commits: maxCommits,
					max_comments: maxComments,
					max_files: maxFiles,
					max_patch_lines: maxPatchLines,
				},
				hint:
					'For full raw data call get_pull_request, ' +
					'list_pull_request_files, list_pull_request_commits, ' +
					'list_pull_request_reviews, or list_review_comments.',
			},
		};

		let anyTruncated = false;

		if (wantDescription) {
			result.sections.push('description');
			result.description = summarizePrDescription(pr, { maxBodyLength });
			if (result.description.body.truncated) {
				anyTruncated = true;
			}
		}

		if (wantCommits) {
			result.sections.push('commits');
			const commits: PullRequestCommit[] = await client.getPullRequestCommits(owner, repo, prNumber);
			result.commits = summarizeCommits(commits, { maxItems: maxCommits });
			if (result.commits.truncated) {
				anyTruncated = true;
			}
		}

		if (wantConversation) {
			result.sections.push('conversation');
			// Forgejo treats PR conversation as issue comments — same endpoint.
			const comments: IssueComment[] = await client.getIssueComments(owner, repo, prNumber);
			result.conversation = summarizeComments(comments, { maxItems: maxComments, maxBodyLength });
			if (result.conversation.truncated) {
				anyTruncated = true;
			}
		}

		if (wantFiles) {
			result.sections.push('files_overview');
			const files: PullRequestFile[] = await client.getPullRequestFiles(owner, repo, prNumber);
			result.files_overview = summarizeFilesOverview(files, { maxItems: maxFiles, maxPatchLines });
			if (result.files_overview.truncated) {
				anyTruncated = true;
			}
		}

		if (wantReviews) {
			result.sections.push('reviews');
			const reviewsObj: PullRequestReview[] = await client.getPullRequestReviews(owner, repo, prNumber);
			result.reviews = summarizeReviews(reviewsObj, { maxBodyLength });
			if (result.reviews.items.some((r) => r.body.truncated)) {
				anyTruncated = true;
			}
		}

		if (wantCi) {
			result.sections.push('ci_status');
			const headSha = pr.head.sha;
			const headBranch = pr.head.ref;
			const raw: CommitStatus[] = headSha
				? await client.getCommitStatuses(owner, repo, headSha)
				: [];
			const statuses = deduplicateStatuses(raw);
			const summary = summarizeStatuses(statuses);
			result.ci_status = {
				head_sha: headSha,
				head_branch: headBranch,
				summary,
				statuses,
			};
		}

		result._meta.truncated = anyTruncated;
		return result;
	},
};
