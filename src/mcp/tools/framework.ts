/**
 * Tool framework.
 *
 * Each MCP tool is a plain object: name, JSON Schema for inputs, a short but
 * rich description (so the LLM knows when to call it), and an async handler
 * that takes parsed args + the Forgejo client wrapper. The handler returns a
 * JSON-serializable payload that the server wraps as TextContent.
 *
 * Handlers throw on error — the server catches and converts to
 * `{content: [{type:'text', text: errMsg}], isError: true}` per MCP spec
 * (https://modelcontextprotocol.io/docs/concepts/tools#error-handling).
 */

import type { JsonSchema } from './schema';
import type { McpForgejoClient } from '../client';
import type { McpInstanceConfig } from '../config';

export interface ToolCallArgs {
	/** Parsed tool arguments object (already validated against the schema). */
	args: Record<string, unknown>;
	/** Forgejo client with instance URL + token already set. */
	client: McpForgejoClient;
	/** The resolved instance config (for owner/repo defaults from env). */
	config: McpInstanceConfig;
}

export type ToolHandler = (args: ToolCallArgs) => Promise<unknown>;

/**
 * Sentinel return shape indicating binary image data. Tool handlers return
 * this when the result should be emitted as an MCP `ImageContent` block
 * (`{type: 'image', data, mimeType}`) rather than text. The server's
 * `tools/call` dispatcher inspects every tool result for `__image === true`
 * and routes it into an image content block instead of JSON.stringify-ing it.
 *
 * This keeps binary payload as base64 end-to-end — never as garbled UTF-8
 * text, never as a JSON-encoded string. Agents (`Claude Code`, `Copilot`,
 * `Codex`) can either route the image straight to their LLM vision model,
 * or call their own `write_file` tool with the base64 to persist it.
 */
export interface ImageToolResult {
	__image: true;
	/** Base64-encoded binary bytes of the image. */
	data: string;
	/** MIME type (e.g. `image/png`, `image/jpeg`, `image/gif`). */
	mimeType: string;
	/** Optional filename hint for agents that want to suggest a save path. */
	filename?: string;
}

export interface Tool {
	name: string;
	description: string;
	inputSchema: JsonSchema;
	handler: ToolHandler;
}

/** Resolve owner from args or fall back to env-provided default. */
export function resolveOwner(args: Record<string, unknown>, config: McpInstanceConfig): string {
	const fromArgs = args['owner'];
	if (typeof fromArgs === 'string' && fromArgs.trim() !== '') {
		return fromArgs.trim();
	}
	if (config.defaultOwner) {
		return config.defaultOwner;
	}
	throw new Error("'owner' is required (set it as a tool argument or via FORGEJO_OWNER env var)");
}

/** Resolve repo from args or fall back to env-provided default. */
export function resolveRepo(args: Record<string, unknown>, config: McpInstanceConfig): string {
	const fromArgs = args['repo'];
	if (typeof fromArgs === 'string' && fromArgs.trim() !== '') {
		return fromArgs.trim();
	}
	if (config.defaultRepo) {
		return config.defaultRepo;
	}
	throw new Error("'repo' is required (set it as a tool argument or via FORGEJO_REPO env var)");
}

/** Coerce a tool argument to a positive integer. Throws on bad input. */
export function resolveNumber(args: Record<string, unknown>, key: string): number {
	const v = args[key];
	if (typeof v === 'number' && Number.isInteger(v) && v >= 1) {
		return v;
	}
	if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
		const n = parseInt(v.trim(), 10);
		if (n >= 1) {
			return n;
		}
	}
	throw new Error(`'${key}' must be a positive integer`);
}
