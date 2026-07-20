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

/**
 * Pagination metadata returned by every list tool. Agents read this to know
 * whether more pages exist and how to fetch them.
 */
export interface PaginationMeta {
	/** 1-based page number that was fetched. */
	page: number;
	/** Page size used for the fetch. */
	page_size: number;
	/** Number of items actually returned (may be < page_size on the last page). */
	returned: number;
	/** True when the returned items count equals the page size, suggesting more pages exist. */
	has_more: boolean;
}

/**
 * Clamp a tool arg to a positive integer in `[min, max]`, falling back to
 * `fallback` when missing/invalid. Mirrors responseFormat.clampInt but lives
 * here to keep framework.ts self-contained for tool handlers.
 */
function clampIntArg(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.min(max, Math.max(min, Math.trunc(value)));
	}
	if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		return Math.min(max, Math.max(min, parseInt(value.trim(), 10)));
	}
	return fallback;
}

/**
 * Resolve `page` and `page_size` tool args. Both default to 1 and 30
 * respectively; both clamp to their schema-declared ranges. Centralised
 * here so every paginated tool behaves identically.
 */
export function resolvePagination(
	args: Record<string, unknown>,
	defaultPageSize = 30,
	maxPageSize = 50,
): { page: number; pageSize: number } {
	return {
		page: clampIntArg(args.page, 1, 10_000, 1),
		pageSize: clampIntArg(args.page_size, 1, maxPageSize, defaultPageSize),
	};
}

/**
 * Build the pagination metadata block from the resolved args and the
 * number of items the fetch returned.
 */
export function buildPaginationMeta(
	page: number,
	pageSize: number,
	returned: number,
): PaginationMeta {
	return {
		page,
		page_size: pageSize,
		returned,
		has_more: returned >= pageSize,
	};
}

/**
 * Perform a SINGLE-PAGE paged GET against the Forgejo API. Replaces the
 * SDK's `requestAllPages` (which would fetch every page until empty) with
 * a single bounded request — prevents DoS on large repos (a 10 000-issue
 * repo previously caused 200+ sequential page requests).
 *
 * `path` should already be URL-encoded; this helper appends
 * `?page=&page_size=` (or `&page=&page_size=` if path already has a `?`).
 *
 * Returns the raw parsed array (untouched). Callers apply compact
 * summarizers after the fetch.
 */
export async function pagedRequest<T = unknown>(
	client: { rawRequest: <R = unknown>(method: string, endpoint: string) => Promise<R> },
	path: string,
	page: number,
	pageSize: number,
): Promise<T[]> {
	const sep = path.includes('?') ? '&' : '?';
	const pagedPath = `${path}${sep}page=${page}&limit=${pageSize}`;
	const result = await client.rawRequest<unknown>('GET', pagedPath);
	return Array.isArray(result) ? (result as T[]) : [];
}
