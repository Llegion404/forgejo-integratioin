/**
 * CI status read tools.
 *
 * Exposes the Forgejo `/repos/{owner}/{repo}/statuses/{sha}` endpoint via
 * the SDK's `getCommitStatuses` method. Two tools:
 *
 * - `get_pr_ci_status`  — PR-number keyed. Resolves `head.sha` from the PR,
 *   calls `getCommitStatuses`, deduplicates, and returns a summary verdict.
 *   Use this when you only know the PR number.
 * - `get_commit_statuses` — raw SHA keyed. Same dedup pipeline, no PR lookup.
 *   Use this when you already have a 40-char commit SHA (e.g. from
 *   `list_pull_request_commits`).
 *
 * The Forgejo REST API returns every historical status record for a SHA
 * (initial `pending` + final `success`/`failure` per CI job). We collapse
 * by `context` keeping the newest `created_at`, mirroring the VS Code
 * extension's `PRDetailsContentProvider.deduplicateStatuses`.
 */

import type { CommitStatus } from 'forgejo-ts';
import { Tool, resolveOwner, resolveRepo, resolveNumber, resolvePagination, pagedRequest, buildPaginationMeta } from './framework';
import { objectSchema, ownerSchema, repoSchema, numberSchema, shaSchema, pageSchema, pageSizeSchema } from './schema';
import { deduplicateStatuses, summarizeStatuses, StatusSummary } from '../utils/statusDedup';

export const getPrCiStatusTool: Tool = {
	name: 'get_pr_ci_status',
	description:
		'Fetch CI check runs for the head SHA of a pull request. Returns ' +
		'the deduplicated latest status per context (collapses initial ' +
		'pending + final success/failure pairs), the head sha, head branch, ' +
		'and a summary verdict (pass/fail/pending/none). Use this instead ' +
		'of get_commit_statuses when you only know the PR number.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
		},
		['number'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const prNumber = resolveNumber(args, 'number');
		const pr = await client.getPullRequest(owner, repo, prNumber);
		// PRs with a deleted source repo have `head: null` — guard against
		// the resulting TypeError so the tool degrades to a clear "no SHA"
		// payload instead of crashing the whole call.
		const sha = pr.head?.sha ?? '';
		const headBranch = pr.head?.ref ?? '';
		// Cap to 50 statuses (single page) — enough for any realistic PR's
		// CI footprint; agents needing history can call get_commit_statuses
		// with explicit pagination.
		const raw = sha
			? await pagedRequest<CommitStatus>(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(sha)}`, 1, 50)
			: [];
		const statuses = deduplicateStatuses(raw);
		const summary: StatusSummary = summarizeStatuses(statuses);
		return {
			head_sha: sha,
			head_branch: headBranch,
			statuses,
			summary,
		};
	},
};

export const getCommitStatusesTool: Tool = {
	name: 'get_commit_statuses',
	description:
		'Fetch CI check runs for a specific commit SHA. Returns ' +
		'deduplicated statuses (latest per context) plus a summary verdict. ' +
		'Pass the 40-char commit SHA, not a branch name or ref. Call ' +
		'get_pr_ci_status instead if you only know the PR number. ' +
		'Paginated: pass page (default 1) and page_size (default 30, max 50).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			sha: shaSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['sha'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const sha = String(args['sha']);
		const { page, pageSize } = resolvePagination(args);
		const raw = await pagedRequest<CommitStatus>(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/statuses/${encodeURIComponent(sha)}`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, raw.length);
		const statuses = deduplicateStatuses(raw);
		const summary: StatusSummary = summarizeStatuses(statuses);
		return { sha, statuses, summary, _meta: { pagination } };
	},
};

export const ciStatusTools: Tool[] = [getPrCiStatusTool, getCommitStatusesTool];
