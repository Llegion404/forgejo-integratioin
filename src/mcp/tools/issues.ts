/**
 * Issue read-only tools.
 *
 * Maps to these Forgejo REST endpoints via the forgejo-ts SDK or rawRequest:
 * - list_issues         → listIssues(owner, repo, state?)
 * - get_issue           → getIssue(owner, repo, number) + getIssueComments (fan-out)
 * - list_issue_comments → getIssueComments(owner, repo, number)
 * - get_issue_timeline   → getIssueTimeline(owner, repo, number)
 * - list_repo_labels    → rawRequest GET /repos/{owner}/{repo}/labels
 *
 * All handlers throw on error; the server wraps the error as a tool-call
 * result with `isError: true` per MCP spec. The Forgejo SDK paginates
 * automatically for the *list endpoints — results may be large, so the
 * caller should request narrow `state` filters when possible.
 *
 * Compact-by-default + `full` toggle: every tool with `full: false` (the
 * default) returns an agent-optimised summary that drops noise (avatar_urls,
 * full user objects, embedded asset metadata) and bounds body strings.
 * Setting `full: true` returns the raw SDK payload unchanged for the rare
 * case where an agent needs an omitted field.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	numberSchema,
	issueStateSchema,
	fullSchema,
} from './schema';
import {
	summarizeIssue,
	summarizeIssueListItem,
	summarizeComments,
	clampInt,
	readBool,
	DEFAULT_MAX_BODY_LENGTH,
	DEFAULT_MAX_COMMENTS,
	IssueSummary,
	ConversationSummary,
} from '../utils/responseFormat';
import type { Issue, IssueComment } from 'forgejo-ts';

export const listIssuesTool: Tool = {
	name: 'list_issues',
	description:
		'List issues in a Forgejo repository. Default (full=false) ' +
		'returns a compact array of issue summaries with number, title, ' +
		'state, bounded body (≤2000 chars), html_url, dates, author ' +
		'({login, full_name?}), labels (names only), and comment count. ' +
		'Use state=open (default), closed, or all. PRs are NOT included ' +
		'(the SDK filters them). Pass full=true for the raw SDK payload ' +
		'(untouched, includes avatar_urls, assets, milestone, assignee, etc.).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			state: issueStateSchema,
			full: fullSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters per issue body when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const state = (args['state'] as 'open' | 'closed' | 'all' | undefined) ?? 'open';
		const issues = await client.listIssues(owner, repo, state);
		if (readBool(args.full, false)) {
			return issues;
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		// SDK declares IssueListItem[] but the real Forgejo API returns the
		// full Issue shape (body, labels, assignees included). Cast to widen.
		return (issues as unknown as Issue[]).map((i) => summarizeIssueListItem(i, { maxBodyLength }));
	},
};

export const getIssueTool: Tool = {
	name: 'get_issue',
	description:
		'Fetch a single issue by number. Default (full=false) returns ' +
		'an agent-optimised envelope: number, title, state, bounded body, ' +
		'html_url, created/updated/closed/due dates, author + assignees ' +
		'({login, full_name?}), labels (names only), milestone (title only), ' +
		'comment count, is_locked, attachments (issue-level assets reduced to ' +
		'{name, size, uuid?}); PLUS a `conversation` section with the issue ' +
		'comment thread (bounded body, capped count) fetched in parallel. ' +
		'Pass include_conversation=false to skip the conversation fetch. ' +
		'Pass full=true for the raw SDK payload (issue object only — no ' +
		'conversation fan-out, untouched avatar_urls, full asset metadata).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			full: fullSchema,
			include_conversation: {
				type: 'boolean',
				default: true,
				description:
					'Whether to fan out and attach the issue comment thread (default). ' +
					'Set false to fetch only the issue object (one HTTP call). Ignored when full=true.',
			},
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters for the issue body and each comment body. Default 2000. Ignored when full=true.',
			},
			max_comments: {
				type: 'integer',
				minimum: 1,
				maximum: 200,
				default: 50,
				description: 'Max number of comments to keep in the conversation section. Default 50. Ignored when full=true.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');

		// `full: true` short-circuit — return the raw SDK Issue payload
		// untouched (backward-compat for the rare case where an agent
		// needs a field the compact path drops). No conversation fan-out.
		if (readBool(args.full, false)) {
			return client.getIssue(owner, repo, number);
		}

		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		const maxComments = clampInt(args.max_comments, 1, 200, DEFAULT_MAX_COMMENTS);
		const wantConversation = readBool(args.include_conversation, true);

		// Fan out in parallel: issue + comments at once. Saves a round-trip
		// when the agent will need both (the usual case — to fully take
		// over an issue, you need the conversation thread).
		const [issue, comments] = await Promise.all([
			client.getIssue(owner, repo, number) as Promise<Issue>,
			wantConversation
				? (client.getIssueComments(owner, repo, number) as Promise<IssueComment[]>)
				: Promise.resolve([] as IssueComment[]),
		]);

		const summary: IssueSummary = summarizeIssue(issue, { maxBodyLength });

		let conversation: ConversationSummary | undefined;
		let anyTruncated = summary.body.truncated;
		if (wantConversation) {
			conversation = summarizeComments(comments, { maxItems: maxComments, maxBodyLength });
			if (conversation.truncated) {
				anyTruncated = true;
			}
			if (conversation.items.some((c) => c.body.truncated)) {
				anyTruncated = true;
			}
		}

		return {
			...summary,
			conversation,
			_meta: {
				truncated: anyTruncated,
				caps: {
					max_body_length: maxBodyLength,
					max_comments: maxComments,
				},
				hint:
					'For the raw unchanged issue object pass full=true. ' +
					'For full timeline events call get_issue_timeline. ' +
					'For full comment list (no caps) call list_issue_comments with full=true.',
			},
		};
	},
};

export const listIssueCommentsTool: Tool = {
	name: 'list_issue_comments',
	description:
		'List comments on an issue (or PR — Forgejo uses the same endpoint ' +
		'for both). Default (full=false) returns a compact array: each ' +
		'comment has {id, author:{login,full_name?}, created_at, body ' +
		'(bounded ≤2000 chars)}. Pass full=true for the raw SDK payload ' +
		'(untouched html_url, full user objects, unbounded bodies). ' +
		'Paginated automatically.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			full: fullSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters per comment body when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const comments: IssueComment[] = await client.getIssueComments(owner, repo, number);
		if (readBool(args.full, false)) {
			return comments;
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return summarizeComments(comments, { maxItems: DEFAULT_MAX_COMMENTS, maxBodyLength });
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
