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

/** Maximum attachment size the server will fetch and base64-encode in memory. 25 MB. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Network timeout for a single attachment fetch. */
const ATTACHMENT_TIMEOUT_MS = 30_000;

export const getAttachmentTool: Tool = {
	name: 'get_attachment',
	description:
		'Fetch the raw bytes of a Forgejo file attachment by UUID. Returns ' +
		'an MCP image content block (base64 data + MIME type) — the agent ' +
		'can route it to a vision-capable LLM, or use its own write_file ' +
		'tool to persist the bytes to disk (e.g. ./screenshot.png). Lookup ' +
		'the UUID first via list_issue_attachments, or read it from the ' +
		'`![alt](/attachments/{uuid})` markdown reference in an issue/PR ' +
		'body or comment. Hard caps: 25 MB max size, 30 s timeout. ' +
		'Attachments larger than 25 MB return a metadata envelope instead.',
	inputSchema: objectSchema(
		{
			uuid: uuidSchema,
		},
		['uuid'],
	),
	async handler({ args, config }): Promise<unknown> {
		const uuid = String(args.uuid);
		const url = `${base(config)}/attachments/${encodeURIComponent(uuid)}`;

		// Use AbortSignal.timeout so a hung Forgejo server doesn't pin the
		// stdio process indefinitely. The SDK always sets one; raw fetch here
		// bypasses the SDK so we must set our own.
		const resp = await fetch(url, {
			headers: authHeader(config.token) ? { Authorization: authHeader(config.token) } : {},
			redirect: 'follow',
			signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
		});
		if (!resp.ok) {
			throw new Error(`HTTP ${resp.status}: attachment ${uuid} could not be fetched`);
		}

		// Check Content-Length BEFORE buffering so we can refuse oversized
		// attachments without OOM-ing the stdio process. A 1 GB attachment
		// would otherwise allocate ~4 GB peak (ArrayBuffer + base64 + JSON).
		const contentLength = parseInt(resp.headers.get('content-length') ?? '', 10);
		if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
			return {
				uuid,
				url,
				size: contentLength,
				mime_type: resp.headers.get('content-type') ?? 'application/octet-stream',
				is_binary: true,
				truncated: true,
				max_bytes: MAX_ATTACHMENT_BYTES,
				warning: `Attachment is ${contentLength} bytes; exceeds ${MAX_ATTACHMENT_BYTES} cap. Fetch directly via browser or increase the cap.`,
			};
		}

		const buf = Buffer.from(await resp.arrayBuffer());

		// Defensive: if Content-Length was missing/lying, check actual size now.
		if (buf.length > MAX_ATTACHMENT_BYTES) {
			return {
				uuid,
				url,
				size: buf.length,
				mime_type: resp.headers.get('content-type') ?? 'application/octet-stream',
				is_binary: true,
				truncated: true,
				max_bytes: MAX_ATTACHMENT_BYTES,
				warning: `Attachment is ${buf.length} bytes; exceeds ${MAX_ATTACHMENT_BYTES} cap.`,
			};
		}

		const mimeType = resp.headers.get('content-type') ?? 'application/octet-stream';
		const result: ImageToolResult = {
			__image: true,
			data: buf.toString('base64'),
			mimeType,
		};
		// Filename hint for agents that want to suggest a save path. Forgejo
		// sends Content-Disposition; parse the filename if present.
		const cd = resp.headers.get('content-disposition');
		if (cd) {
			const match = cd.match(/filename="?([^";]+)"?/i);
			if (match) {
				result.filename = match[1];
			}
		}
		return result;
	},
};

export const attachmentTools: Tool[] = [listIssueAttachmentsTool, getAttachmentTool];
