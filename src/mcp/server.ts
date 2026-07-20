#!/usr/bin/env node
/**
 * Forgejo MCP Server — entry point.
 *
 * Spawns a stdio JSON-RPC server implementing the Model Context Protocol
 * (https://modelcontextprotocol.io). Designed to be launched by an MCP
 * client (Claude Code, Codex, or GitHub Copilot) per their respective config
 * formats. The server resolves Forgejo credentials from env vars first
 * (FORGEJO_URL, FORGEJO_TOKEN, FORGEJO_OWNER, FORGEJO_REPO) and falls back
 * to ~/.config/forgejo-mcp/instances.json written by the VS Code extension.
 *
 * Process layout:
 *   stdin  — JSON-RPC messages from the agent (newline-delimited)
 *   stdout — JSON-RPC responses (newline-delimited; SINGLE writer)
 *   stderr — diagnostics logs (only when MCP_DEBUG=1 or --debug)
 *
 * The server is read-only v1: 27 tools covering Forgejo issues, PRs, CI
 * status, reactions, branch protection, image attachments, releases, file
 * contents, and tags. Most read tools return a compact, agent-optimised
 * summary by default (`full: false`): drops avatar URLs, trims user objects
 * to `{login, full_name?}`, flattens labels to names-only, bounds body
 * strings, caps list counts, and (for get_issue / get_pull_request) fans out
 * multiple SDK calls in parallel to return a single envelope so an agent can
 * take over an issue/PR with one tool call instead of N round trips. Pass
 * `full: true` on any tool that supports it to receive the raw, untouched
 * SDK payload instead — for the rare case when the agent needs a field the
 * compact path omits. Write actions (create_issue, merge_pr, etc.) are
 * planned for v2 — see src/mcp/tools/index.ts.
 *
 * Protocol version advertised: 2025-06-18.
 */

import { StdioTransport, JsonRpcResponse, JsonRpcRequest, JsonRpcNotification, makeErrorResponse, makeResultResponse } from './transport';
import { resolveConfig } from './config';
import { createClient, McpForgejoClient } from './client';
import { ALL_TOOLS, findTool, Tool } from './tools';
import { JsonSchema } from './tools/schema';
import { ForgejoApiError, ForgejoNetworkError } from 'forgejo-ts';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const SERVER_NAME = 'forgejo-mcp';
const SERVER_VERSION = '0.1.0';

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/**
 * High-level instructions advertised in the `initialize` response. Agents
 * (Claude Code, Codex, Copilot) read this to understand the server's
 * conventions before they start calling tools. Keep it short, action-oriented,
 * and focused on the few things that genuinely surprise agents:
 *   - read-only (no mutation tools)
 *   - compact-by-default with `full=true` escape hatch
 *   - all list tools take page+limit
 *   - owner/repo are inferred from FORGEJO_OWNER/FORGEJO_REPO env vars
 */
const SERVER_INSTRUCTIONS =
	'Forgejo MCP server (read-only). All tools are safe — none mutate state. ' +
	'Most tools return a compact, agent-optimised shape by default; pass ' +
	'full=true on tools that support it to get the raw SDK payload. All list ' +
	'tools accept page (1-based) and limit (default 30) to paginate. ' +
	'Owner/repo are optional when FORGEJO_OWNER/FORGEJO_REPO env vars are set.';

function debugEnabled(): boolean {
	return process.env.MCP_DEBUG === '1' || process.argv.includes('--debug');
}

function log(...args: unknown[]): void {
	if (debugEnabled()) {
		process.stderr.write(`[forgejo-mcp] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`);
	}
}

/**
 * Negotiate the protocol version per MCP spec: if the client advertises a
 * version we support, echo it back; otherwise fall back to our preferred
 * (newest) version. (https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
 */
function negotiateProtocolVersion(clientVersion: unknown): string {
	if (typeof clientVersion === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(clientVersion)) {
		return clientVersion;
	}
	return PROTOCOL_VERSION;
}

/**
 * Convert a thrown tool error into a structured MCP `isError` payload.
 *
 * ForgejoApiError → expose `http_status`, `http_status_text`, and the
 * `response_body` so agents can programmatically branch on 404 vs 403 vs
 * 429 etc. The text content stays human-readable; the structured data is
 * attached as a second JSON content block per MCP spec
 * (https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling).
 *
 * Network errors get their own envelope. Unknown errors fall back to the
 * plain message-string behaviour.
 */
function buildToolErrorContent(err: unknown, toolName: string): { content: unknown[]; isError: true } {
	const msg = (err as Error)?.message || String(err);
	if (err instanceof ForgejoApiError) {
		const structured = {
			tool: toolName,
			error_kind: 'http',
			http_status: err.statusCode,
			http_status_text: err.statusText,
			response_body: err.responseBody.slice(0, 2048),
			rate_limited: err.statusCode === 429,
		};
		return {
			content: [
				{ type: 'text', text: `Tool '${toolName}' failed: HTTP ${err.statusCode} ${err.statusText}` },
				{ type: 'text', text: JSON.stringify(structured) },
			],
			isError: true,
		};
	}
	if (err instanceof ForgejoNetworkError) {
		const structured = {
			tool: toolName,
			error_kind: 'network',
			url: err.url,
			cause: err.cause?.message,
		};
		return {
			content: [
				{ type: 'text', text: `Tool '${toolName}' failed: network error reaching ${err.url}` },
				{ type: 'text', text: JSON.stringify(structured) },
			],
			isError: true,
		};
	}
	return {
		content: [{ type: 'text', text: `Tool '${toolName}' failed: ${msg}` }],
		isError: true,
	};
}

/**
 * Detect a rate-limit (HTTP 429) response and sleep per `Retry-After`
 * before retrying the tool handler exactly once. Returns the handler's
 * result on retry, or throws the original 429 if no Retry-After or after
 * the retry also fails.
 *
 * The `responseBody` of a ForgejoApiError carries the raw response text;
 * some Forgejo deployments put a JSON envelope with `message` in it.
 * Retry-After is unavailable here (the SDK doesn't surface response
 * headers), so we fall back to a fixed 1-second backoff.
 */
async function invokeWithRateLimitRetry<T>(
	fn: () => Promise<T>,
	toolName: string,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof ForgejoApiError && err.statusCode === 429) {
			const delayMs = 1000; // SDK doesn't expose headers; fixed 1s backoff
			log(`rate-limited on '${toolName}'; retrying after ${delayMs}ms`);
			await new Promise((r) => setTimeout(r, delayMs));
			return fn();
		}
		throw err;
	}
}

/** Tool definition as exposed in tools/list (per MCP spec). */
interface JsonRpcTool {
	name: string;
	description: string;
	inputSchema: JsonSchema;
}

/** Validate tool args against its JSON Schema. Returns [valid, error]. */
function validateArgs(tool: Tool, args: unknown): [true, unknown] | [false, string] {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		if (Object.keys(tool.inputSchema.properties ?? {}).length === 0) {
			return [true, {}];
		}
		return [false, 'Arguments must be a JSON object'];
	}
	const obj = args as Record<string, unknown>;
	const required = tool.inputSchema.required ?? [];
	for (const key of required) {
		if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
			return [false, `Missing required argument: '${key}'`];
		}
	}
	const properties = tool.inputSchema.properties ?? {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) {
			continue; // treat undefined as "not provided"
		}
		const propSpec = properties[key];
		if (!propSpec) {
			const allowed = Object.keys(properties);
			return [false, `Unknown argument '${key}'. Allowed: ${allowed.join(', ') || '(none)'}`];
		}
		const err = checkType(key, value, propSpec);
		if (err) {
			return [false, err];
		}
	}
	return [true, obj];
}

/**
 * Validate a single value against a JSON Schema fragment.
 *
 * Returns `null` when valid, or an error-message string when invalid. Handles
 * every type our schemas actually use: `string`, `integer`, `number`,
 * `boolean`, `object`, `array`. Enum check runs for any type. Object schemas
 * recurse so nested `sections`-style args are validated, including
 * `additionalProperties: false` enforcement.
 */
function checkType(name: string, value: unknown, spec: JsonSchema): string | null {
	// Enum check runs for any type (was previously nested inside the string
	// branch, letting `state: 42` bypass validation entirely).
	if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
		return `'${name}' must be one of: ${spec.enum.map((v) => JSON.stringify(v)).join(', ')}`;
	}

	switch (spec.type) {
		case 'string': {
			if (typeof value !== 'string') {
				return `'${name}' must be a string`;
			}
			if (typeof spec.minLength === 'number' && value.length < spec.minLength) {
				return `'${name}' must be at least ${spec.minLength} characters`;
			}
			return null;
		}
		case 'integer': {
			if (typeof value === 'number' && Number.isInteger(value)) {
				// fall through to range checks below
			} else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
				// accept digit-strings as integers (legacy convenience)
			} else {
				return `'${name}' must be an integer`;
			}
			const n = typeof value === 'number' ? value : parseInt(value as string, 10);
			if (typeof spec.minimum === 'number' && n < spec.minimum) {
				return `'${name}' must be >= ${spec.minimum}`;
			}
			if (typeof spec.maximum === 'number' && n > spec.maximum) {
				return `'${name}' must be <= ${spec.maximum}`;
			}
			return null;
		}
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return `'${name}' must be a number`;
			}
			if (typeof spec.minimum === 'number' && value < spec.minimum) {
				return `'${name}' must be >= ${spec.minimum}`;
			}
			if (typeof spec.maximum === 'number' && value > spec.maximum) {
				return `'${name}' must be <= ${spec.maximum}`;
			}
			return null;
		}
		case 'boolean': {
			// Strict boolean validation. Previously `full: "true"` (string)
			// passed validation but silently evaluated to `false` inside
			// readBool — the agent thought it asked for full payload, got
			// compact. Reject loudly instead.
			if (typeof value !== 'boolean') {
				return `'${name}' must be a boolean (true or false)`;
			}
			return null;
		}
		case 'object': {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				return `'${name}' must be an object`;
			}
			const inner = value as Record<string, unknown>;
			const innerProps = spec.properties ?? {};
			const requiredInner = spec.required ?? [];
			for (const k of requiredInner) {
				if (!(k in inner) || inner[k] === undefined || inner[k] === null) {
					return `'${name}.${k}' is required`;
				}
			}
			for (const [k, v] of Object.entries(inner)) {
				if (v === undefined) {
					continue;
				}
				const innerSpec = innerProps[k];
				if (!innerSpec) {
					if (spec.additionalProperties === false) {
						const allowed = Object.keys(innerProps);
						return `'${name}.${k}' is not allowed. Allowed keys: ${allowed.join(', ') || '(none)'}`;
					}
					continue; // additionalProperties unspecified → allow
				}
				const innerErr = checkType(`${name}.${k}`, v, innerSpec);
				if (innerErr) {
					return innerErr;
				}
			}
			return null;
		}
		case 'array': {
			if (!Array.isArray(value)) {
				return `'${name}' must be an array`;
			}
			const itemSpec = spec.items;
			if (itemSpec) {
				for (let i = 0; i < value.length; i++) {
					const itemErr = checkType(`${name}[${i}]`, value[i], itemSpec);
					if (itemErr) {
						return itemErr;
					}
				}
			}
			return null;
		}
		default:
			// Unknown type or no type field → no value-level validation.
			return null;
	}
}

/**
 * Build the MCP server. Pure — no IO. Exposed for unit tests so the JSON-RPC
 * dispatch logic can be tested without spawning a real stdio transport.
 */
export function buildMcpServer(
	transport: { onMessage?: ((m: JsonRpcNotification | JsonRpcRequest) => void | Promise<void | JsonRpcResponse>) },
	clientFactory: () => McpForgejoClient,
	configFactory: () => ReturnType<typeof resolveConfig>,
) {
	transport.onMessage = async (msg): Promise<JsonRpcResponse | undefined> => {
		if (!('id' in msg)) {
			// Notification — no response. Handle initialized ping.
			if (msg.method === 'notifications/initialized') {
				log('Client initialized');
			}
			return undefined;
		}

		const id = msg.id;

		switch (msg.method) {
			case 'initialize': {
				const clientCaps = (msg as JsonRpcRequest).params as { protocolVersion?: unknown; capabilities?: unknown } | undefined;
				const negotiated = negotiateProtocolVersion(clientCaps?.protocolVersion);
				return makeResultResponse(id, {
					protocolVersion: negotiated,
					capabilities: {
						tools: { listChanged: false },
					},
					serverInfo: {
						name: SERVER_NAME,
						version: SERVER_VERSION,
					},
					instructions: SERVER_INSTRUCTIONS,
				});
			}

			case 'ping':
				return makeResultResponse(id, {});

			case 'tools/list': {
				const tools: JsonRpcTool[] = ALL_TOOLS.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				}));
				return makeResultResponse(id, { tools });
			}

			case 'tools/call': {
				const params = (msg as JsonRpcRequest).params as { name?: string; arguments?: unknown } | undefined;
				const toolName = params?.name;
				if (typeof toolName !== 'string') {
					return makeErrorResponse(id, INVALID_PARAMS, 'tools/call requires a "name" string parameter');
				}
				const tool = findTool(toolName);
				if (!tool) {
					return makeErrorResponse(id, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
				}
				const args = params?.arguments ?? {};
				const [valid, validatedOrError] = validateArgs(tool, args);
				if (!valid) {
					return makeResultResponse(id, {
						content: [{ type: 'text', text: `Validation error: ${validatedOrError}` }],
						isError: true,
					});
				}
			try {
				const result = await invokeWithRateLimitRetry(
					() => tool.handler({
						args: (validatedOrError as Record<string, unknown>) ?? {},
						client: clientFactory(),
						config: configFactory(),
					}),
					toolName,
				);
				// Dispatch results that carry image bytes as MCP ImageContent
				// blocks instead of JSON.stringify-ing them. Tool handlers
				// opt in by returning `{ __image: true, data: base64, mimeType }`.
				let content: unknown[];
				if (
					result &&
					typeof result === 'object' &&
					(result as { __image?: unknown }).__image === true
				) {
					const img = result as { data: string; mimeType: string; filename?: string };
					content = [{ type: 'image', data: img.data, mimeType: img.mimeType }];
				} else {
					content = [{
						type: 'text',
						text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
					}];
				}
				return makeResultResponse(id, {
					content,
					isError: false,
				});
			} catch (err) {
					log('tool error', toolName, (err as Error)?.message ?? String(err));
					const { content, isError } = buildToolErrorContent(err, toolName);
					return makeResultResponse(id, { content, isError });
				}
			}

			case 'resources/list':
				return makeErrorResponse(id, METHOD_NOT_FOUND, 'This server does not expose resources');

			case 'prompts/list':
				return makeErrorResponse(id, METHOD_NOT_FOUND, 'This server does not expose prompts');

			default:
				return makeErrorResponse(id, METHOD_NOT_FOUND, `Unknown method: ${msg.method}`);
		}
	};
}

/**
 * Run the Forgejo MCP server on stdio. Resolves when stdin closes.
 *
 * Exposed for direct invocation as `node out/mcp/server.js`. When invoked
 * from a test, pass a custom transport factory.
 */
export async function runServer(): Promise<void> {
	let config;
	try {
		config = resolveConfig();
	} catch (err) {
		process.stderr.write(`[forgejo-mcp] Configuration error: ${(err as Error).message}\n`);
		process.exit(1);
	}

	let client: McpForgejoClient;
	try {
		client = createClient(config);
	} catch (err) {
		process.stderr.write(`[forgejo-mcp] Failed to build Forgejo client: ${(err as Error).message}\n`);
		process.exit(1);
	}

	const transport = new StdioTransport();
	buildMcpServer(
		transport,
		() => client,
		() => config,
	);
	await transport.start();
	log('Forgejo MCP server ready', { instanceUrl: config.instanceUrl, tools: ALL_TOOLS.length });
}

// Run only when invoked as a script (not when imported by tests).
if (require.main === module) {
	void runServer().catch((err) => {
		process.stderr.write(`[forgejo-mcp] Fatal: ${(err as Error).message}\n`);
		process.exit(1);
	});
}
