/**
 * Pull request read-only tools.
 *
 * Maps to these forgejo-ts SDK methods:
 * - list_pull_requests        → listPullRequests(owner, repo, state?)
 * - get_pull_request          → getPullRequest(owner, repo, number)
 *                              + fan-out: getPullRequestCommits +
 *                                getIssueComments + getPullRequestFiles +
 *                                (opt) getPullRequestReviews + (opt)
 *                                getCommitStatuses
 * - list_pull_request_files   → getPullRequestFiles(owner, repo, number)
 * - list_pull_request_commits → getPullRequestCommits(owner, repo, number)
 * - get_pull_request_refs     → getPullRequestRefs(owner, repo, number)
 * - list_pull_request_reviews → getPullRequestReviews(owner, repo, number)
 * - list_review_comments      → getReviewComments(owner, repo, prNumber, reviewId)
 *
 * Compact-by-default + `full` toggle (mirrors `issues.ts`):
 * - full=false (default) returns an agent-optimised summary that drops
 *   avatar_urls, shortens SHAs, bounds body strings, and (for
 *   get_pull_request) folds in commits + conversation + files_overview in
 *   a single fan-out call.
 * - full=true returns the raw SDK payload untouched.
 *
 * The multi-section summary previously exposed as the standalone tool
 * `get_pull_request_summary` now lives inside `get_pull_request` (default
 * path) — agents had no reason to call both, and the extra tool name
 * added noise to `tools/list`. The single-tool default keeps the same
 * `sections` toggles, `max_*` caps, and `_meta.hint` from the old tool.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber, resolvePagination, buildPaginationMeta, pagedRequest } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	numberSchema,
	pullRequestStateSchema,
	fullSchema,
	pageSchema,
	pageSizeSchema,
} from './schema';
import type { JsonSchema } from './schema';
import { deduplicateStatuses, summarizeStatuses } from '../utils/statusDedup';
import {
	summarizePrDescription,
	summarizePrListItem,
	summarizeCommits,
	summarizeComments,
	summarizeFilesOverview,
	summarizeReviews,
	truncatePatch,
	clampInt,
	readBool,
	DEFAULT_MAX_BODY_LENGTH,
	DEFAULT_MAX_COMMITS,
	DEFAULT_MAX_COMMENTS,
	DEFAULT_MAX_FILES,
} from '../utils/responseFormat';
import type {
	PullRequest,
	PullRequestFile,
	PullRequestCommit,
	PullRequestReview,
	IssueComment,
	CommitStatus,
} from 'forgejo-ts';

/** Toggle map for which sections to include in the get_pull_request compact envelope. */
interface SectionToggles {
	description?: boolean;
	commits?: boolean;
	conversation?: boolean;
	files_overview?: boolean;
	reviews?: boolean;
	ci_status?: boolean;
}

/** Schema property for the nested `sections` object on get_pull_request. */
const sectionsSchema: JsonSchema = {
	type: 'object',
	description:
		'Which sections to include in the compact envelope. All default to ' +
		'false; the handler enables the four essentials (description, commits, ' +
		'conversation, files_overview) unless you explicitly set one to false. ' +
		'Reviews and ci_status are opt-in — set to true to include them. ' +
		'Ignored when full=true.',
	properties: {
		description: { type: 'boolean' },
		commits: { type: 'boolean' },
		conversation: { type: 'boolean' },
		files_overview: { type: 'boolean' },
		reviews: { type: 'boolean' },
		ci_status: { type: 'boolean' },
	},
	additionalProperties: false,
};

export const listPullRequestsTool: Tool = {
	name: 'list_pull_requests',
	description:
		'List pull requests in a Forgejo repository. Default (full=false) ' +
		'returns a compact array of PR overviews: each item has number, ' +
		'title, state, draft, merged, mergeable, base/head refs, bounded ' +
		'body (≤2000 chars), html_url, author ({login, full_name?}), labels ' +
		'(names only), and comment count. Use state=open (default), closed, ' +
		'or all. Pass full=true for the raw SDK payload (untouched, includes ' +
		'avatar_urls, full SHAs, merge_commit_sha, head repo, etc.). ' +
		'Paginated: pass page (default 1) and page_size (default 30, max 50).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			state: pullRequestStateSchema,
			full: fullSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters per PR body when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const state = (args.state as 'open' | 'closed' | 'all' | undefined) ?? 'open';
		const { page, pageSize } = resolvePagination(args);
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}`;
		const prs = await pagedRequest<PullRequest>(client, path, page, pageSize);
		const pagination = buildPaginationMeta(page, pageSize, prs.length);
		if (readBool(args.full, false)) {
			return { items: prs, _meta: { pagination } };
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return {
			items: prs.map((p) => summarizePrListItem(p, { maxBodyLength })),
			_meta: { pagination },
		};
	},
};

export const getPullRequestTool: Tool = {
	name: 'get_pull_request',
	description:
		'Fetch a single pull request by number. Default (full=false) ' +
		'returns a size-bounded, agent-optimised envelope in ONE call: ' +
		'description (title + bounded body + state + refs + mergeable + ' +
		'labels), commits (short SHA + subject + author/date, capped), ' +
		'conversation (issue comments thread, bounded + capped), and ' +
		'files_overview (file status + additions/deletions/changes — NO ' +
		'patches by default). Set sections.reviews=true and/or ' +
		'sections.ci_status=true to add those. Every section carries ' +
		'truncated/total/returned flags so you know when to drill in. ' +
		'Pass full=true for the raw SDK payload (single PR object only, ' +
		'untouched, NO commits/comments/files fan-out). For a single facet ' +
		'in full detail, call the specific tool (list_pull_request_files ' +
		'with include_patch=true, list_pull_request_commits, etc.).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			full: fullSchema,
			sections: sectionsSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters for the PR body and each comment body. Default 2000. Ignored when full=true.',
			},
			max_commits: {
				type: 'integer',
				minimum: 1,
				maximum: 250,
				default: 50,
				description: 'Max number of commit items to return. Default 50. Ignored when full=true.',
			},
			max_comments: {
				type: 'integer',
				minimum: 1,
				maximum: 200,
				default: 50,
				description: 'Max number of conversation comment items to return. Default 50. Ignored when full=true.',
			},
			max_files: {
				type: 'integer',
				minimum: 1,
				maximum: 500,
				default: 100,
				description: 'Max number of file items in files_overview. Default 100. Ignored when full=true.',
			},
			max_patch_lines: {
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 0,
				description:
					'Max patch lines to keep PER FILE in files_overview. ' +
					'0 (default) drops patches entirely — only counts are ' +
					'returned. Set >0 to keep a bounded snippet with hunk headers. Ignored when full=true.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const prNumber = resolveNumber(args, 'number');

		// `full: true` short-circuit — return the raw SDK PR payload only.
		if (readBool(args.full, false)) {
			return client.getPullRequest(owner, repo, prNumber);
		}

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

		const result: Record<string, unknown> = {
			number: pr.number,
			title: pr.title,
			state: pr.state,
			sections: [] as string[],
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
					'For the raw PR object pass full=true. For full raw data on a single ' +
					'facet call list_pull_request_files, list_pull_request_commits, ' +
					'list_pull_request_reviews, or list_review_comments.',
			},
		};

		// Fan out the optional sections in parallel — saves multiple round
		// trips when the agent needs more than one. Description is computed
		// synchronously from `pr` (no API call).
		//
		// Each section fetcher is wrapped to *never* reject: failures land
		// in the `_meta.warnings` array so the primary PR payload is always
		// returned. Previously a 403 on `getIssueComments` (private repo)
		// would reject the whole `Promise.all` and discard the PR object.
		const sectionFetches: { name: string; fn: () => Promise<void> }[] = [];

		let anyTruncated = false;
		const warnings: string[] = [];

		if (wantDescription) {
			(result.sections as string[]).push('description');
			result.description = summarizePrDescription(pr, { maxBodyLength });
			if ((result.description as { body: { truncated: boolean } }).body.truncated) {
				anyTruncated = true;
			}
		}

		if (wantCommits) {
			(result.sections as string[]).push('commits');
			sectionFetches.push({
				name: 'commits',
				fn: async () => {
					const commits = await pagedRequest<PullRequestCommit>(
						client,
						`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/commits`,
						1, maxCommits,
					);
					result.commits = summarizeCommits(commits, { maxItems: maxCommits });
					if ((result.commits as { truncated: boolean }).truncated) {
						anyTruncated = true;
					}
				},
			});
		}

		if (wantConversation) {
			(result.sections as string[]).push('conversation');
			sectionFetches.push({
				name: 'conversation',
				fn: async () => {
					// Forgejo treats PR conversation as issue comments — same endpoint.
					const comments = await pagedRequest<IssueComment>(
						client,
						`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`,
						1, maxComments,
					);
					result.conversation = summarizeComments(comments, { maxItems: maxComments, maxBodyLength });
					if ((result.conversation as { truncated: boolean }).truncated) {
						anyTruncated = true;
					}
				},
			});
		}

		if (wantFiles) {
			(result.sections as string[]).push('files_overview');
			sectionFetches.push({
				name: 'files_overview',
				fn: async () => {
					const files = await pagedRequest<PullRequestFile>(
						client,
						`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files`,
						1, maxFiles,
					);
					result.files_overview = summarizeFilesOverview(files, { maxItems: maxFiles, maxPatchLines });
					if ((result.files_overview as { truncated: boolean }).truncated) {
						anyTruncated = true;
					}
				},
			});
		}

		if (wantReviews) {
			(result.sections as string[]).push('reviews');
			sectionFetches.push({
				name: 'reviews',
				fn: async () => {
					const reviewsObj = await pagedRequest<PullRequestReview>(
						client,
						`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`,
						1, 50, // reviews don't have a dedicated cap; use the page-size max
					);
					result.reviews = summarizeReviews(reviewsObj, { maxBodyLength });
					if ((result.reviews as { items: { body: { truncated: boolean } }[] }).items.some((r) => r.body.truncated)) {
						anyTruncated = true;
					}
				},
			});
		}

		if (wantCi) {
			(result.sections as string[]).push('ci_status');
			sectionFetches.push({
				name: 'ci_status',
				fn: async () => {
					// Deleted-head-repo PRs have `head: null`. Degrade to an
					// explicit "no SHA available" verdict instead of throwing.
					const headSha = pr.head?.sha ?? '';
					const headBranch = pr.head?.ref ?? '';
					if (!headSha) {
						result.ci_status = {
							head_sha: '',
							head_branch: headBranch,
							summary: 'none' as const,
							statuses: [],
							warning: 'PR head repo is deleted or head SHA is unavailable; CI status cannot be determined.',
						};
						return;
					}
					const raw = await pagedRequest<CommitStatus>(
						client,
						`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(headSha)}`,
						1, 50,
					);
					const statuses = deduplicateStatuses(raw);
					const summary = summarizeStatuses(statuses);
					result.ci_status = {
						head_sha: headSha,
						head_branch: headBranch,
						summary,
						statuses,
					};
				},
			});
		}

		// Promise.allSettled so a single section failure doesn't kill the
		// whole envelope. Each settled rejection becomes a `_meta.warnings`
		// entry; the rest of the sections still populate.
		const settled = await Promise.allSettled(sectionFetches.map((s) => s.fn()));
		settled.forEach((s, i) => {
			if (s.status === 'rejected') {
				const reason = s.reason;
				const msg = reason instanceof Error ? reason.message : String(reason);
				warnings.push(`Section '${sectionFetches[i].name}' failed: ${msg}`);
			}
		});

		(result._meta as { truncated: boolean; warnings?: string[] }).truncated = anyTruncated;
		if (warnings.length > 0) {
			(result._meta as { warnings?: string[] }).warnings = warnings;
		}
		return result;
	},
};

export const listPullRequestFilesTool: Tool = {
	name: 'list_pull_request_files',
	description:
		'List the files changed in a pull request. For each file returns ' +
		'filename, status (added/modified/removed/renamed), additions, ' +
		'deletions, changes, blob_url, raw_url, and (when present) the ' +
		'unified diff patch. Use this for code review. On large PRs the ' +
		'embedded `patch` strings can blow up the response — pass ' +
		'include_patch=false to drop patches entirely (keeps counts only), ' +
		'or max_patch_lines=N to keep a bounded snippet per file (hunk ' +
		'headers preserved). For a one-shot size-bounded PR overview use ' +
		'get_pull_request (default compact shape) instead.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			include_patch: {
				type: 'boolean',
				default: true,
				description:
					'Whether to include the unified-diff `patch` string on each ' +
					'file. Default true (raw API behaviour). Set false to strip ' +
					'all patches and mark each file with patch_excluded: true — ' +
					'useful when you only need the file list + counts.',
			},
			max_patch_lines: {
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 0,
				description:
					'Max patch lines to keep PER FILE. 0 (default) = unlimited ' +
					'(raw behaviour). >0 truncates each patch, preserving @@ hunk ' +
					'headers, and sets patch_truncated: true on truncated files.',
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const includePatch = args.include_patch !== false;
		const maxPatchLines = clampInt(args.max_patch_lines, 0, 1000, 0);
		const { page, pageSize } = resolvePagination(args);

		const files = await pagedRequest<PullRequestFile>(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, files.length);

		// No options set → return the raw array unchanged (backward compat
		// for the per-file shape, but now wrapped in a pagination envelope).
		let items: unknown[];
		if (includePatch && maxPatchLines <= 0) {
			items = files;
		} else {
			items = files.map((f) => {
				if (!f.patch) {
					return { ...f, patch_excluded: true };
				}
				if (!includePatch) {
					const stripped: PullRequestFile = { ...f };
					delete stripped.patch;
					return { ...stripped, patch_excluded: true };
				}
				const bounded = truncatePatch(f.patch, maxPatchLines);
				return { ...f, patch: bounded.text, patch_truncated: bounded.truncated };
			});
		}
		return { items, _meta: { pagination } };
	},
};

export const listPullRequestCommitsTool: Tool = {
	name: 'list_pull_request_commits',
	description:
		'List the commits included in a pull request. Default (full=false) ' +
		'returns a compact array: each commit has short_sha, subject (first ' +
		'line of the message), commit_author (name), author ' +
		'({login, full_name?}), and date. Pass full=true for the raw SDK ' +
		'payload (untouched sha, full multi-line commit body, html_url).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			full: fullSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
			max_items: {
				type: 'integer',
				minimum: 1,
				maximum: 250,
				default: 50,
				description: 'Max number of commit items to return when full=false. Default 50. Ignored when full=true. Deprecated: prefer page_size for pagination.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const { page, pageSize } = resolvePagination(args);
		const commits = await pagedRequest<PullRequestCommit>(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/commits`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, commits.length);
		if (readBool(args.full, false)) {
			return { items: commits, _meta: { pagination } };
		}
		const maxItems = clampInt(args.max_items, 1, 250, DEFAULT_MAX_COMMITS);
		return {
			items: summarizeCommits(commits, { maxItems }).items,
			_meta: { pagination },
		};
	},
};

export const getPullRequestRefsTool: Tool = {
	name: 'get_pull_request_refs',
	description:
		'Fetch the base and head refs of a pull request. Returns ' +
		'{base: string, head: string} — branch names you can use with git ' +
		'checkout, fetch, or merge.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		return client.getPullRequestRefs(owner, repo, number);
	},
};

export const listPullRequestReviewsTool: Tool = {
	name: 'list_pull_request_reviews',
	description:
		'List reviews submitted on a pull request. Default (full=false) ' +
		'returns a compact array: each review has {id, state ' +
		'(APPROVE/REQUEST_CHANGES/COMMENT/PENDING/DISMISSED), author ' +
		'({login, full_name?}), submitted_at, body (bounded ≤2000 chars)}. ' +
		'Pass full=true for the raw SDK payload (untouched html_url, full ' +
		'user objects, unbounded bodies). Paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			full: fullSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters per review body when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const { page, pageSize } = resolvePagination(args);
		const reviews = await pagedRequest<PullRequestReview>(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/reviews`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, reviews.length);
		if (readBool(args.full, false)) {
			return { items: reviews, _meta: { pagination } };
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return {
			items: summarizeReviews(reviews, { maxBodyLength }).items,
			_meta: { pagination },
		};
	},
};

export const listReviewCommentsTool: Tool = {
	name: 'list_review_comments',
	description:
		'List the inline code comments attached to a specific review on a ' +
		'pull request. For each comment returns id, body, file path, line, ' +
		'old/new position, diff hunk, author, created_at, updated_at, and ' +
		'pull_request_review_id. Use this after list_pull_request_reviews ' +
		'to drill into a specific review.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			reviewId: {
				type: 'integer',
				description: 'ID of the review (from list_pull_request_reviews)',
				minimum: 1,
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const prNumber = resolveNumber(args, 'number');
		const reviewId = resolveNumber(args, 'reviewId');
		const { page, pageSize } = resolvePagination(args);
		const items = await pagedRequest(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews/${reviewId}/comments`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, items.length);
		return { items, _meta: { pagination } };
	},
};

export const pullRequestTools: Tool[] = [
	listPullRequestsTool,
	getPullRequestTool,
	listPullRequestFilesTool,
	listPullRequestCommitsTool,
	getPullRequestRefsTool,
	listPullRequestReviewsTool,
	listReviewCommentsTool,
];
