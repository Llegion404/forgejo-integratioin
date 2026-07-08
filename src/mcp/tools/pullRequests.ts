/**
 * Pull request read-only tools.
 *
 * Maps to these forgejo-ts SDK methods:
 * - list_pull_requests        → listPullRequests(owner, repo, state?)
 * - get_pull_request          → getPullRequest(owner, repo, number)
 * - list_pull_request_files   → getPullRequestFiles(owner, repo, number)
 * - list_pull_request_commits → getPullRequestCommits(owner, repo, number)
 * - get_pull_request_refs     → getPullRequestRefs(owner, repo, number)
 * - list_pull_request_reviews → getPullRequestReviews(owner, repo, number)
 * - list_review_comments      → getReviewComments(owner, repo, prNumber, reviewId)
 *
 * All return rich typed objects from the SDK. The SDK paginates lists
 * automatically; large PRs may return many files/commits so callers should
 * prefer narrow filters (state=open) when possible.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	numberSchema,
	pullRequestStateSchema,
} from './schema';
import { truncatePatch, clampInt } from '../utils/responseFormat';
import type { PullRequestFile } from 'forgejo-ts';

export const listPullRequestsTool: Tool = {
	name: 'list_pull_requests',
	description:
		'List pull requests in a Forgejo repository. Returns an array of PR ' +
		'objects with number, title, body, state, user, head (with ref/sha/' +
		'repo), base ref, mergeable, merged, draft, labels, and comment ' +
		'count. Use state=open (default), closed, or all.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			state: pullRequestStateSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const state = (args.state as 'open' | 'closed' | 'all' | undefined) ?? 'open';
		return client.listPullRequests(owner, repo, state);
	},
};

export const getPullRequestTool: Tool = {
	name: 'get_pull_request',
	description:
		'Fetch a single pull request by number. Returns the full PR object ' +
		'including head/base refs, mergeable, merged, merge_commit_sha, ' +
		'labels, assignees, requested_reviewers, draft, and milestones.',
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
		return client.getPullRequest(owner, repo, number);
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
		'get_pull_request_summary instead.',
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
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const includePatch = args.include_patch !== false;
		const maxPatchLines = clampInt(args.max_patch_lines, 0, 1000, 0);

		const files: PullRequestFile[] = await client.getPullRequestFiles(owner, repo, number);

		// No options set → return the raw array unchanged (backward compat).
		if (includePatch && maxPatchLines <= 0) {
			return files;
		}

		// Post-process: drop or bound patches, but keep the array shape so
		// existing callers that expect an array still work.
		return files.map((f) => {
			if (!f.patch) {
				return { ...f, patch_excluded: true };
			}
			if (!includePatch) {
				const stripped: PullRequestFile = { ...f };
				delete stripped.patch;
				return { ...stripped, patch_excluded: true };
			}
			// includePatch === true, maxPatchLines > 0 → bound each patch.
			const bounded = truncatePatch(f.patch, maxPatchLines);
			return { ...f, patch: bounded.text, patch_truncated: bounded.truncated };
		});
	},
};

export const listPullRequestCommitsTool: Tool = {
	name: 'list_pull_request_commits',
	description:
		'List the commits included in a pull request. For each commit ' +
		'returns sha, commit message, author (with name/email/date), and ' +
		'html_url. Useful for understanding the change history of a PR.',
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
		return client.getPullRequestCommits(owner, repo, number);
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
		'List reviews submitted on a pull request. For each review returns ' +
		'id, state (APPROVE / REQUEST_CHANGES / COMMENT / PENDING / ' +
		'DISMISSED), body, user, submitted_at, and html_url. Paginated.',
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
		return client.getPullRequestReviews(owner, repo, number);
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
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const prNumber = resolveNumber(args, 'number');
		const reviewId = resolveNumber(args, 'reviewId');
		return client.getReviewComments(owner, repo, prNumber, reviewId);
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
