/**
 * Reaction read tools.
 *
 * forgejo-ts has no typed methods for the reactions endpoints, so these
 * tools use `rawRequest('GET', ...)` — the same pattern the VS Code
 * extension's wrapper (`src/api/forgejoClient.ts:78-100`) uses for its own
 * reaction methods.
 *
 * Two read-only tools:
 * - `list_comment_reactions` — reactions on a PR or issue comment.
 * - `list_issue_reactions`   — reactions attached directly to an issue body
 *   (not a comment).
 *
 * The Forgejo REST shape is identical for both: an array of
 * `{ id, user: { login, avatar_url? }, reaction }`. Reaction values are
 * restricted to: +1, -1, laugh, hooray, confused, heart, rocket, eyes.
 *
 * Note: the `/issues/{number}/reactions` path uses the issue **number**
 * (URL-visible), the same identifier `get_issue` uses — NOT the database
 * `id`. Confirmed by `src/webview/issueDetail/provider.ts:144`.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import { objectSchema, ownerSchema, repoSchema, numberSchema, commentIdSchema } from './schema';

export const listCommentReactionsTool: Tool = {
	name: 'list_comment_reactions',
	description:
		'List emoji reactions on a PR or issue comment. Each returned ' +
		'entry has { id, user: { login, avatar_url }, reaction }. ' +
		'Reaction values are the Forgejo/Gitea strings: +1, -1, laugh, ' +
		'hooray, confused, heart, rocket, eyes. Pass the `id` field ' +
		'from a list_issue_comments entry.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			comment_id: commentIdSchema,
		},
		['comment_id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const commentId = resolveNumber(args, 'comment_id');
		return client.rawRequest(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${commentId}/reactions`,
		);
	},
};

export const listIssueReactionsTool: Tool = {
	name: 'list_issue_reactions',
	description:
		'List emoji reactions attached directly to an issue body (not a ' +
		'comment). Same shape as list_comment_reactions. Pass the issue ' +
		'number (the URL-visible identifier, same as get_issue).',
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
		const issueNumber = resolveNumber(args, 'number');
		return client.rawRequest(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/reactions`,
		);
	},
};

export const reactionTools: Tool[] = [listCommentReactionsTool, listIssueReactionsTool];
