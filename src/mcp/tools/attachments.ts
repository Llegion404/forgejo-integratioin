/**
 * Image attachment read tools.
 *
 * Forgejo stores file attachments (screenshots, logs, etc.) attached to issue
 * and PR bodies and comments under `/attachments/{uuid}`. The body markdown
 * references them as `![alt](/attachments/{uuid})`. Two read-only tools:
 *
 * - `list_issue_attachments`  — list every asset attached at the issue
 *   (or PR — Forgejo uses issue numbers for PRs internally). Returns
 *   `{ id, name, size, download_count, created_at, uuid, browser_download_url }[]`.
 * - `get_attachment`         — fetch the raw bytes of a single attachment
 *   by UUID. Returns an MCP ImageContent block (`{__image: true, data, mimeType}`)
 *   when the response is an image MIME. For non-image MIMEs, returns an
 *   ImageContent-like marker with `mimeType: 'application/octet-stream'` so
 *   agents can still save the binary via their own write_file tool.
 *
 * Both raw URLs bypass the forgejo-ts SDK because the SDK's `rawRequest`
 * parses the response as JSON, which corrupts binary bytes. We hit the raw
 * REST endpoint directly with `fetch` and read the byte stream into a Buffer.
 *
 * Approach A from the design discussion: the MCP server stays read-only and
 * returns base64 image bytes; agents that want the file on disk use their
 * own `write_file` tool (sandboxed to their own workspace root).
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber, ImageToolResult } from './framework';
import { objectSchema, ownerSchema, repoSchema, numberSchema, uuidSchema } from './schema';
import type { McpInstanceConfig } from '../config';

/** Strip trailing slash from instance URL so we can append the API path. */
function base(config: McpInstanceConfig): string {
	return config.instanceUrl.replace(/\/$/, '');
}

/** Build the auth header value for Forgejo (PAT format: `token <token>`). */
function authHeader(token: string): string {
	return token ? `token ${token}` : '';
}

export const listIssueAttachmentsTool: Tool = {
	name: 'list_issue_attachments',
	description:
		'List files attached to an issue or pull request body. For PRs ' +
		'pass the PR number — Forgejo uses issue numbers for PRs internally. ' +
		'Each entry has { id, name, size, download_count, created_at, ' +
		'uuid, browser_download_url }. Pass the `uuid` field to ' +
		'get_attachment to download the binary bytes of an attachment.',
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
		const number = resolveNumber(args, 'number');
		return client.rawRequest(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/assets`,
		);
	},
};

export const getAttachmentTool: Tool = {
	name: 'get_attachment',
	description:
		'Fetch the raw bytes of a Forgejo file attachment by UUID. Returns ' +
		'an MCP image content block (base64 data + MIME type) — the agent ' +
		'can route it to a vision-capable LLM, or use its own write_file ' +
		'tool to persist the bytes to disk (e.g. ./screenshot.png). Lookup ' +
		'the UUID first via list_issue_attachments, or read it from the ' +
		'`![alt](/attachments/{uuid})` markdown reference in an issue/PR ' +
		'body or comment.',
	inputSchema: objectSchema(
		{
			uuid: uuidSchema,
		},
		['uuid'],
	),
	async handler({ args, config }): Promise<unknown> {
		const uuid = String(args.uuid);
		const url = `${base(config)}/attachments/${encodeURIComponent(uuid)}`;
		const resp = await fetch(url, {
			headers: authHeader(config.token) ? { Authorization: authHeader(config.token) } : {},
			redirect: 'follow',
		});
		if (!resp.ok) {
			throw new Error(`HTTP ${resp.status}: attachment ${uuid} could not be fetched`);
		}
		const buf = Buffer.from(await resp.arrayBuffer());
		const mimeType = resp.headers.get('content-type') ?? 'application/octet-stream';
		const result: ImageToolResult = {
			__image: true,
			data: buf.toString('base64'),
			mimeType,
		};
		return result;
	},
};

export const attachmentTools: Tool[] = [listIssueAttachmentsTool, getAttachmentTool];
