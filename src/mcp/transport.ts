/**
 * Minimal stdio transport for the Model Context Protocol (MCP).
 *
 * MCP over stdio is just newline-delimited JSON-RPC 2.0: each message is a
 * single line of UTF-8 JSON terminated by '\n'. We read line-by-line from
 * stdin and write JSON.stringify(message) + '\n' to stdout.
 *
 * Stdout is reserved for protocol messages. All diagnostics go to stderr.
 *
 * The transport hand-buffers incoming bytes and splits on '\n'. This avoids
 * the Node `readline` module's requirement for a real Readable stream
 * (readline.createInterface calls `.resume()` on its input), which makes the
 * transport testable against any object that emits `data` and `close`
 * events.
 *
 * Unknown methods, malformed JSON, and internal handler errors are turned
 * into JSON-RPC error responses per spec
 * (https://modelcontextprotocol.io/specification/2025-06-18/basic).
 */

import type { Readable, Writable } from 'stream';

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string | number | null;
	method: string;
	params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown> | unknown[];
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export type MessageHandler = (message: JsonRpcMessage) =>
	void | Promise<void | JsonRpcResponse>;

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export function makeErrorResponse(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	const resp: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } };
	if (data !== undefined) {
		resp.error!.data = data;
	}
	return resp;
}

export function makeResultResponse(
	id: string | number | null,
	result: unknown,
): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result };
}

/**
 * Parses a single JSON-RPC message line. Returns null for blank lines
 * (which we silently skip per JSON-RPC transport conventions).
 */
export function parseMessage(line: string): JsonRpcMessage | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (err) {
		throw new ParseError(`Invalid JSON: ${(err as Error).message}`);
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new ParseError('Top-level JSON-RPC payload must be an object');
	}
	const raw = parsed as Record<string, unknown>;
	if (raw.jsonrpc !== '2.0') {
		throw new ParseError('jsonrpc must be "2.0"');
	}
	if (typeof raw.method !== 'string') {
		throw new ParseError('method must be a string');
	}
	if (raw.id === undefined) {
		return { jsonrpc: '2.0', method: raw.method, params: raw.params } as JsonRpcNotification;
	}
	if (typeof raw.id !== 'string' && typeof raw.id !== 'number' && raw.id !== null) {
		throw new ParseError('id must be string, number, or null');
	}
	return {
		jsonrpc: '2.0',
		id: raw.id as string | number | null,
		method: raw.method,
		params: raw.params,
	} as JsonRpcRequest;
}

class ParseError extends Error {}

/**
 * Stdio transport. Reads newline-delimited JSON from stdin and writes
 * JSON-RPC responses (also newline-delimited) to stdout.
 *
 * Usage:
 *   const transport = new StdioTransport();
 *   transport.onMessage = async (msg) => { ... return response; };
 *   await transport.start();
 */
export class StdioTransport {
	private buffer = '';
	public onMessage?: MessageHandler;
	public onError?: (err: Error) => void;
	private readonly stdin: NodeJS.ReadStream | Readable;
	private readonly stdout: NodeJS.WriteStream | Writable;
	private closed = false;
	private bound = false;
	private dataListener?: (chunk: unknown) => void;
	private closeListener?: () => void;
	private errorListener?: (err: unknown) => void;

	constructor(
		stdin: NodeJS.ReadStream | Readable = process.stdin,
		stdout: NodeJS.WriteStream | Writable = process.stdout,
	) {
		this.stdin = stdin;
		this.stdout = stdout;
	}

	async start(): Promise<void> {
		// Attach listeners. We bind once and remember the wrappers so close()
		// can detach them.
		this.dataListener = (chunk: unknown) => this.handleData(chunk as Buffer | string);
		this.closeListener = () => { this.closed = true; };
		this.errorListener = (err: unknown) => { this.onError?.(err as Error); };

		const src = this.stdin as unknown as {
			on: (event: string, cb: ((...args: unknown[]) => void)) => unknown;
			removeListener?: (event: string, cb: ((...args: unknown[]) => void)) => unknown;
		};
		src.on('data', this.dataListener);
		src.on('close', this.closeListener);
		src.on('error', this.errorListener);
		this.bound = true;
	}

	private handleData(chunk: Buffer | string): void {
		this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		let newlineIdx: number;
		while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, newlineIdx);
			this.buffer = this.buffer.slice(newlineIdx + 1);
			void this.handleLine(line);
		}
	}

	private async handleLine(line: string): Promise<void> {
		let msg: JsonRpcMessage | null;
		try {
			msg = parseMessage(line);
		} catch (err) {
			const parseErr = err as ParseError;
			this.send(makeErrorResponse(null, PARSE_ERROR, parseErr.message));
			return;
		}
		if (!msg) {
			return;
		}
		if (!this.onMessage) {
			return;
		}
		try {
			const result = await this.onMessage(msg);
			if (result !== undefined) {
				this.send(result);
			}
		} catch (err) {
			this.send(makeErrorResponse(
				'id' in msg ? (msg as JsonRpcRequest).id : null,
				INTERNAL_ERROR,
				(err as Error).message || 'Internal error',
			));
		}
	}

	send(response: JsonRpcResponse): void {
		if (this.closed) {
			return;
		}
		const out = this.stdout as unknown as { write: (s: string) => boolean };
		out.write(JSON.stringify(response) + '\n');
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.bound && this.dataListener) {
			const src = this.stdin as unknown as {
				removeListener?: (event: string, cb: ((...args: unknown[]) => void)) => unknown;
			};
			src.removeListener?.('data', this.dataListener);
			if (this.closeListener) {
				src.removeListener?.('close', this.closeListener);
			}
			if (this.errorListener) {
				src.removeListener?.('error', this.errorListener);
			}
		}
		this.bound = false;
	}
}
