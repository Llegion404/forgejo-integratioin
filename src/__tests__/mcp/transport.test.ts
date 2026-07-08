import { EventEmitter } from 'events';
import {
	StdioTransport,
	parseMessage,
	makeErrorResponse,
	makeResultResponse,
	JsonRpcResponse,
} from '../../mcp/transport';

class MockStdout {
	public writes: string[] = [];
	public closed = false;
	write(s: string): boolean {
		this.writes.push(s);
		return true;
	}
}

class MockStdin extends EventEmitter {
	pushData(s: string): void {
		setImmediate(() => this.emit('data', Buffer.from(s, 'utf8')));
	}
	pushLine(line: string): void {
		this.pushData(line + '\n');
	}
}

describe('parseMessage', () => {
	it('parses a JSON-RPC request', () => {
		const msg = parseMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
		expect(msg).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
	});

	it('parses a JSON-RPC notification (no id)', () => {
		const msg = parseMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
		expect(msg).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized', params: undefined });
	});

	it('returns null for blank lines', () => {
		expect(parseMessage('')).toBeNull();
		expect(parseMessage('   ')).toBeNull();
		expect(parseMessage('\n\t')).toBeNull();
	});

	it('throws on invalid JSON', () => {
		expect(() => parseMessage('not json')).toThrow(/Invalid JSON/);
	});

	it('throws when jsonrpc version missing', () => {
		expect(() => parseMessage(JSON.stringify({ method: 'foo' }))).toThrow(/jsonrpc must be "2.0"/);
	});

	it('throws when method missing', () => {
		expect(() => parseMessage(JSON.stringify({ jsonrpc: '2.0', id: 1 }))).toThrow(/method must be a string/);
	});
});

describe('makeErrorResponse / makeResultResponse', () => {
	it('builds a result response', () => {
		expect(makeResultResponse(1, { ok: true })).toEqual({
			jsonrpc: '2.0',
			id: 1,
			result: { ok: true },
		});
	});

	it('builds an error response without data', () => {
		expect(makeErrorResponse(2, -32601, 'nope')).toEqual({
			jsonrpc: '2.0',
			id: 2,
			error: { code: -32601, message: 'nope' },
		});
	});

	it('builds an error response with data', () => {
		const resp = makeErrorResponse('abc', -32601, 'nope', { extra: 1 });
		expect(resp.error!.data).toEqual({ extra: 1 });
	});
});

describe('StdioTransport', () => {
	let stdin: MockStdin;
	let stdout: MockStdout;
	let transport: StdioTransport;

	beforeEach(() => {
		stdin = new MockStdin();
		stdout = new MockStdout();
		transport = new StdioTransport(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
	});

	it('invokes onMessage when a request line arrives', async () => {
		const handler = jest.fn().mockResolvedValue(makeResultResponse(1, { ok: true }));
		transport.onMessage = handler;
		await transport.start();
		const done = new Promise<void>((resolve) => {
			(handler as jest.Mock).mockImplementationOnce(async () => {
				resolve();
				return makeResultResponse(1, { ok: true });
			});
		});
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
		await done;
		await new Promise((r) => setImmediate(r));
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({
			jsonrpc: '2.0',
			id: 1,
			method: 'ping',
			params: undefined,
		});
	});

	it('sends serialized response for a request that returns one', async () => {
		transport.onMessage = jest.fn().mockResolvedValue(makeResultResponse(1, { ok: 1 }));
		await transport.start();
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
		await flushMicrotasks();
		expect(stdout.writes.length).toBe(1);
		expect(JSON.parse(stdout.writes[0])).toEqual({
			jsonrpc: '2.0',
			id: 1,
			result: { ok: 1 },
		});
	});

	it('does not send any response for notifications (handler returns undefined)', async () => {
		transport.onMessage = jest.fn().mockResolvedValue(undefined);
		await transport.start();
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
		await flushMicrotasks();
		expect(stdout.writes.length).toBe(0);
	});

	it('emits a parse error response for malformed JSON', async () => {
		transport.onMessage = jest.fn();
		await transport.start();
		stdin.pushLine('not json');
		await flushMicrotasks();
		expect(stdout.writes.length).toBe(1);
		const resp = JSON.parse(stdout.writes[0]) as JsonRpcResponse;
		expect(resp.id).toBeNull();
		expect(resp.error!.code).toBe(-32700);
	});

	it('does not call handler for blank lines', async () => {
		const handler = jest.fn();
		transport.onMessage = handler;
		await transport.start();
		stdin.pushLine('');
		stdin.pushLine('   ');
		await flushMicrotasks();
		expect(handler).not.toHaveBeenCalled();
		expect(stdout.writes.length).toBe(0);
	});

	it('sends INTERNAL_ERROR when handler throws', async () => {
		transport.onMessage = jest.fn().mockRejectedValue(new Error('boom'));
		await transport.start();
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'foo' }));
		await flushMicrotasks();
		expect(stdout.writes.length).toBe(1);
		const resp = JSON.parse(stdout.writes[0]) as JsonRpcResponse;
		expect(resp.id).toBe(5);
		expect(resp.error!.code).toBe(-32603);
		expect(resp.error!.message).toBe('boom');
	});

	it('handles split multi-line input (buffers partial messages)', async () => {
		const handler = jest.fn().mockResolvedValue(makeResultResponse(2, {}));
		transport.onMessage = handler;
		await transport.start();
		stdin.pushData(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'p' }).slice(0, 10));
		await flushMicrotasks();
		expect(handler).not.toHaveBeenCalled();
		stdin.pushData(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'p' }).slice(10) + '\n');
		await flushMicrotasks();
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

async function flushMicrotasks(): Promise<void> {
	// Two passes: emit the data chunk, then await handler resolution.
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
}
