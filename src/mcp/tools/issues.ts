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

import { Tool, resolveOwner, resolveRepo, resolveNumber, resolvePagination, buildPaginationMeta, pagedRequest } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	numberSchema,
	issueStateSchema,
	fullSchema,
	pageSchema,
	pageSizeSchema,
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
		'(untouched, includes avatar_urls, assets, milestone, assignee, etc.). ' +
		'Paginated: pass page (default 1) and page_size (default 30, max 50). ' +
		'Response includes _meta.pagination.has_more to signal more pages.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			state: issueStateSchema,
			full: fullSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
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
		const { page, pageSize } = resolvePagination(args);
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&type=issues`;
		const issues = await pagedRequest<Issue>(client, path, page, pageSize);
		const pagination = buildPaginationMeta(page, pageSize, issues.length);
		if (readBool(args.full, false)) {
			return { items: issues, _meta: { pagination } };
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return {
			items: issues.map((i) => summarizeIssueListItem(i, { maxBodyLength })),
			_meta: { pagination },
		};
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
		//
		// Use Promise.allSettled instead of Promise.all so a single
		// failing fan-out branch (e.g. comments 403 on a private repo)
		// doesn't discard the rest. The primary `getIssue` failure still
		// throws (rejection becomes the tool's isError response); only the
		// *secondary* fetches degrade to warnings.
		//
		// Conversation fetch is bounded to a single page of size maxComments
		// (default 50, max 200) instead of the SDK's unbounded auto-paging
		// — prevents DoS on issues with thousands of comments.
		const issuePromise = client.getIssue(owner, repo, number) as Promise<Issue>;
		const commentsPromise = wantConversation
			? pagedRequest<IssueComment>(
				client,
				`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
				1,
				maxComments,
			)
			: Promise.resolve([] as IssueComment[]);

		const [issueSettled, commentsSettled] = await Promise.allSettled([issuePromise, commentsPromise]);

		// Primary failure → throw (server wraps as MCP error).
		if (issueSettled.status !== 'fulfilled') {
			throw issueSettled.reason instanceof Error
				? issueSettled.reason
				: new Error(String(issueSettled.reason));
		}
		const issue = issueSettled.value;

		const warnings: string[] = [];
		let comments: IssueComment[] = [];
		if (wantConversation) {
			if (commentsSettled.status === 'fulfilled') {
				comments = commentsSettled.value;
			} else {
				const reason = commentsSettled.reason;
				const msg = reason instanceof Error ? reason.message : String(reason);
				warnings.push(`Failed to fetch conversation: ${msg}`);
			}
		}

		const summary: IssueSummary = summarizeIssue(issue, { maxBodyLength });

		let conversation: ConversationSummary | undefined;
		let anyTruncated = summary.body.truncated;
		if (wantConversation && comments.length > 0) {
			conversation = summarizeComments(comments, { maxItems: maxComments, maxBodyLength });
			if (conversation.truncated) {
				anyTruncated = true;
			}
			if (conversation.items.some((c) => c.body.truncated)) {
				anyTruncated = true;
			}
		} else if (wantConversation && comments.length === 0 && warnings.length === 0) {
			// Synthesize an empty conversation so the agent can tell "no
			// comments yet" apart from "didn't fetch comments".
			conversation = { total: 0, returned: 0, truncated: false, items: [] };
		}

		const _meta: Record<string, unknown> = {
			truncated: anyTruncated,
			caps: {
				max_body_length: maxBodyLength,
				max_comments: maxComments,
			},
			hint:
				'For the raw unchanged issue object pass full=true. ' +
				'For full timeline events call get_issue_timeline. ' +
				'For full comment list (no caps) call list_issue_comments with full=true.',
		};
		if (warnings.length > 0) {
			_meta.warnings = warnings;
		}

		return {
			...summary,
			conversation,
			_meta,
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
		'Paginated: pass page (default 1) and page_size (default 30, max 50).',
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
				description: 'Max characters per comment body when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const { page, pageSize } = resolvePagination(args);
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`;
		const comments = await pagedRequest<IssueComment>(client, path, page, pageSize);
		const pagination = buildPaginationMeta(page, pageSize, comments.length);
		if (readBool(args.full, false)) {
			return { items: comments, _meta: { pagination } };
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return {
			items: summarizeComments(comments, { maxItems: pageSize, maxBodyLength }).items,
			_meta: { pagination },
		};
	},
};

export const getIssueTimelineTool: Tool = {
	name: 'get_issue_timeline',
	description:
		'Fetch the timeline of an issue — every event (opened, closed, ' +
		'labeled, assigned, locked, referenced, cross-referenced, etc.) ' +
		'in chronological order. Useful for understanding the history of an ' +
		'issue without reading every comment. Paginated: pass page (default 1) ' +
		'and page_size (default 30, max 50).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			number: numberSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const number = resolveNumber(args, 'number');
		const { page, pageSize } = resolvePagination(args);
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/timeline`;
		const items = await pagedRequest(client, path, page, pageSize);
		const pagination = buildPaginationMeta(page, pageSize, items.length);
		return { items, _meta: { pagination } };
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
