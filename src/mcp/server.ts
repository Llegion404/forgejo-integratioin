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
 * contents, and tags. Write actions (create_issue, merge_pr, etc.) are
 * planned for v2 — see src/mcp/tools/index.ts.
 *
 * Protocol version advertised: 2025-06-18.
 */

import { StdioTransport, JsonRpcResponse, JsonRpcRequest, JsonRpcNotification, makeErrorResponse, makeResultResponse } from './transport';
import { resolveConfig } from './config';
import { createClient, McpForgejoClient } from './client';
import { ALL_TOOLS, findTool, Tool } from './tools';
import { JsonSchema } from './tools/schema';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'forgejo-mcp';
const SERVER_VERSION = '0.1.0';

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function debugEnabled(): boolean {
	return process.env.MCP_DEBUG === '1' || process.argv.includes('--debug');
}

function log(...args: unknown[]): void {
	if (debugEnabled()) {
		process.stderr.write(`[forgejo-mcp] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`);
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
		const propSpec = properties[key];
		if (!propSpec) {
			const allowed = Object.keys(properties);
			return [false, `Unknown argument '${key}'. Allowed: ${allowed.join(', ') || '(none)'}`];
		}
		const [typeOk, typeErr] = checkType(key, value, propSpec);
		if (!typeOk) {
			return [false, typeErr];
		}
	}
	return [true, obj];
}

function checkType(name: string, value: unknown, spec: JsonSchema): [true] | [false, string] {
	if (spec.type === 'string') {
		if (typeof value !== 'string') {
			return [false, `'${name}' must be a string`];
		}
		if (typeof spec.minLength === 'number' && value.length < spec.minLength) {
			return [false, `'${name}' must be at least ${spec.minLength} characters`];
		}
		if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
			return [false, `'${name}' must be one of: ${spec.enum.join(', ')}`];
		}
	} else if (spec.type === 'integer') {
		if (typeof value !== 'number' || !Number.isInteger(value)) {
			if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
				return [true];
			}
			return [false, `'${name}' must be an integer`];
		}
		if (typeof spec.minimum === 'number' && value < spec.minimum) {
			return [false, `'${name}' must be >= ${spec.minimum}`];
		}
		if (typeof spec.maximum === 'number' && value > spec.maximum) {
			return [false, `'${name}' must be <= ${spec.maximum}`];
		}
	}
	return [true];
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
			case 'initialize':
				return makeResultResponse(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {
						tools: { listChanged: false },
					},
					serverInfo: {
						name: SERVER_NAME,
						version: SERVER_VERSION,
					},
				});

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
				const result = await tool.handler({
					args: (validatedOrError as Record<string, unknown>) ?? {},
					client: clientFactory(),
					config: configFactory(),
				});
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
					const errMsg = (err as Error)?.message || String(err);
					log('tool error', toolName, errMsg);
					return makeResultResponse(id, {
						content: [{ type: 'text', text: `Tool '${toolName}' failed: ${errMsg}` }],
						isError: true,
					});
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
