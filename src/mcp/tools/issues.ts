/**
 * Issue read-only tools.
 *
 * Maps to these Forgejo REST endpoints via the forgejo-ts SDK or rawRequest:
 * - list_issues         → listIssues(owner, repo, state?)
 * - get_issue           → getIssue(owner, repo, number)
 * - list_issue_comments → getIssueComments(owner, repo, number)
 * - get_issue_timeline   → getIssueTimeline(owner, repo, number)
 * - list_repo_labels    → rawRequest GET /repos/{owner}/{repo}/labels
 *
 * All handlers throw on error; the server wraps the error as a tool-call
 * result with `isError: true` per MCP spec. The Forgejo SDK paginates
 * automatically for the *list endpoints — results may be large, so the
 * caller should request narrow `state` filters when possible.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import { objectSchema, ownerSchema, repoSchema, numberSchema, issueStateSchema } from './schema';

export const listIssuesTool: Tool = {
	name: 'list_issues',
	description:
		'List issues in a Forgejo repository. Returns an array of issue ' +
		'objects with number, title, state, body (markdown), user, labels, ' +
		'assignees, created_at, updated_at, closed_at, and comments count. ' +
		'Use state=open (default), closed, or all. PRs are NOT included ' +
		'(the SDK filters them).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			state: issueStateSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const state = (args['state'] as 'open' | 'closed' | 'all' | undefined) ?? 'open';
		return client.listIssues(owner, repo, state);
	},
};

export const getIssueTool: Tool = {
	name: 'get_issue',
	description:
		'Fetch a single issue by number. Returns id, number, title, body ' +
		'(markdown), state, user, labels, assignees, milestone, created_at, ' +
		'updated_at, closed_at, html_url, and comment count.',
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
		return client.getIssue(owner, repo, number);
	},
};

export const listIssueCommentsTool: Tool = {
	name: 'list_issue_comments',
	description:
		'List comments on an issue (or PR — Forgejo uses the same endpoint ' +
		'for both). Returns an array of comments with id, body (markdown), ' +
		'user, created_at, and html_url. Paginated automatically.',
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
		return client.getIssueComments(owner, repo, number);
	},
};

export const getIssueTimelineTool: Tool = {
	name: 'get_issue_timeline',
	description:
		'Fetch the timeline of an issue — every event (opened, closed, ' +
		'labeled, assigned, locked, referenced, cross-referenced, etc.) ' +
		'in chronological order. Useful for understanding the history of an ' +
		'issue without reading every comment. Paginated automatically.',
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
		return client.getIssueTimeline(owner, repo, number);
	},
};

export const listRepoLabelsTool: Tool = {
	name: 'list_repo_labels',
	description:
		'List all labels defined in a repository, returning id, name, and ' +
		'color. Useful before listing issues filtered by label, or when ' +
		'summarising the issue taxonomy of a project.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		return client.rawRequest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`);
	},
};

export const issueTools: Tool[] = [
	listIssuesTool,
	getIssueTool,
	listIssueCommentsTool,
	getIssueTimelineTool,
	listRepoLabelsTool,
];
