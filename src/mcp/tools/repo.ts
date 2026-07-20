/**
 * Repository navigation tools — branches, commits, ref comparison.
 *
 * Four read-only tools that fill in the "things you'd navigate to in the
 * Forgejo repo browser" gap that the v1 surface left uncovered:
 *
 * - `list_repo_branches` — every branch in the repo with its commit + protection flag.
 * - `get_branch`         — single-branch detail (latest commit, protected state).
 * - `list_repo_commits`  — commit history (optionally filtered by sha/path).
 * - `compare_commits`    — diff two refs (base...head) — commits + files summary.
 *
 * All list tools use the same `page`/`page_size` + `_meta.pagination` shape
 * as the rest of the v2 surface.
 */

import { Tool, resolveOwner, resolveRepo, resolvePagination, buildPaginationMeta, pagedRequest } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	branchSchema,
	pathSchema,
	refSchema,
	shaSchema,
	pageSchema,
	pageSizeSchema,
} from './schema';

function repoBase(owner: string, repo: string): string {
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export const listRepoBranchesTool: Tool = {
	name: 'list_repo_branches',
	description:
		'List all branches in a repository. Each branch includes name, commit ' +
		'(sha + url + last author/date), protected (boolean), and ' +
		'protection_branch_url. Use this before creating a PR to verify the ' +
		'base branch name, or to enumerate feature branches. Paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const { page, pageSize } = resolvePagination(args);
		const items = await pagedRequest(
			client,
			`${repoBase(owner, repo)}/branches`,
			page, pageSize,
		);
		return { items, _meta: { pagination: buildPaginationMeta(page, pageSize, items.length) } };
	},
};

export const getBranchTool: Tool = {
	name: 'get_branch',
	description:
		'Fetch a single branch by name. Returns name, commit metadata (sha, ' +
		'commit author, date, message), protected (boolean), and ' +
		'protection_branch_url. Use this to verify a branch exists before ' +
		'checking out, creating a PR against it, or to read its protection state.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			branch: branchSchema,
		},
		['branch'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const branch = String(args.branch);
		return client.rawRequest(
			'GET',
			`${repoBase(owner, repo)}/branches/${encodeURIComponent(branch)}`,
		);
	},
};

export const listRepoCommitsTool: Tool = {
	name: 'list_repo_commits',
	description:
		'List commit history in a repository, optionally filtered by a sha ' +
		'(ref/branch/tag to start from) or path (only commits touching that ' +
		'file). Each commit includes sha, commit message, author + committer ' +
		'(name, email, date), html_url, and verified flag. Use this to ' +
		'reconstruct history outside of a PR — for PR-scoped commits, use ' +
		'list_pull_request_commits. Paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			sha: {
				type: 'string',
				description: 'Optional ref/branch/tag/SHA to start the history from (defaults to repo default branch).',
				minLength: 1,
			},
			path: pathSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const { page, pageSize } = resolvePagination(args);

		const params: string[] = [];
		if (typeof args.sha === 'string' && args.sha.trim() !== '') {
			params.push(`sha=${encodeURIComponent(args.sha.trim())}`);
		}
		if (typeof args.path === 'string' && args.path.trim() !== '') {
			params.push(`path=${encodeURIComponent(args.path.trim())}`);
		}
		const query = params.length > 0 ? `?${params.join('&')}` : '';
		const items = await pagedRequest(
			client,
			`${repoBase(owner, repo)}/commits${query}`,
			page, pageSize,
		);
		return { items, _meta: { pagination: buildPaginationMeta(page, pageSize, items.length) } };
	},
};

export const compareCommitsTool: Tool = {
	name: 'compare_commits',
	description:
		'Compare two refs (base...head) and return commits + file diff summary ' +
		'between them. Both `base` and `head` accept branch names, tag names, ' +
		'or commit SHAs. Returns commits (sha, message, author), total_commits ' +
		'count, and files (filename, status, additions, deletions, changes). ' +
		'Use this to preview what a PR/merge would introduce, or to compare ' +
		'arbitrary points in history. Paginated by Forgejo server cap.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			base: refSchema,
			head: refSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['base', 'head'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const base = String(args.base);
		const head = String(args.head);
		// The compare endpoint doesn't paginate server-side — it returns a
		// fixed-size comparison object. We expose it unchanged.
		const result = await client.rawRequest(
			'GET',
			`${repoBase(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
		);
		return result;
	},
};

export const repoTools: Tool[] = [
	listRepoBranchesTool,
	getBranchTool,
	listRepoCommitsTool,
	compareCommitsTool,
];
