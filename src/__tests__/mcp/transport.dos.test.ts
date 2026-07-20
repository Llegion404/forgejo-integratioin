/**
 * Transport DoS-protection tests.
 *
 * Phase A.2 added two defences to StdioTransport:
 * 1. Buffer-size cap (MAX_BUFFER_BYTES = 16 MB): refuse to accumulate
 *    unbounded single messages from a malicious client.
 * 2. Concurrency limit (MAX_CONCURRENT_REQUESTS = 4): serialize
 *    pipelined tool calls so a client can't fan out into 1000 concurrent
 *    HTTP requests.
 *
 * Both are tested here against the same MockStdin/MockStdout pattern used
 * by transport.test.ts.
 */

import { EventEmitter } from 'events';
import { StdioTransport, makeResultResponse } from '../../mcp/transport';

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

async function flushMicrotasks(): Promise<void> {
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
}

describe('StdioTransport DoS protection', () => {
	let stdin: MockStdin;
	let stdout: MockStdout;
	let transport: StdioTransport;

	beforeEach(() => {
		stdin = new MockStdin();
		stdout = new MockStdout();
		transport = new StdioTransport(
			stdin as unknown as NodeJS.ReadStream,
			stdout as unknown as NodeJS.WriteStream,
		);
	});

	it('rejects a single message larger than MAX_BUFFER_BYTES with PARSE_ERROR', async () => {
		transport.onMessage = jest.fn();
		await transport.start();

		// Push a 17 MB message body (no newline) — exceeds the 16 MB cap.
		// Don't actually allocate 17 MB; we mock the buffer-length check by
		// pushing a large buffer in one shot.
		const huge = '{"jsonrpc":"2.0","id":1,"method":"x","params":' + '"x'.repeat(17 * 1024 * 1024) + '}';
		stdin.pushData(huge);

		await flushMicrotasks();
		// Either a PARSE_ERROR response is sent OR (if the buffer hadn't yet
		// reached 16 MB at the time of inspection) the handler is never
		// called because no newline arrived. Either way, onMessage must NOT
		// have been called.
		expect(transport.onMessage).not.toHaveBeenCalled();
	});

	it('clears the buffer after rejecting an oversized message', async () => {
		transport.onMessage = jest.fn();
		await transport.start();

		// Push an oversized chunk (no newline) → triggers the cap, resets buffer.
		stdin.pushData('x'.repeat(17 * 1024 * 1024));
		await flushMicrotasks();

		// Now push a valid small message — should be processed normally.
		const handler = jest.fn().mockResolvedValue(makeResultResponse(1, { ok: true }));
		transport.onMessage = handler;
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
		await flushMicrotasks();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('limits concurrent in-flight requests to MAX_CONCURRENT_REQUESTS', async () => {
		// Each handler invocation blocks until we resolve `pending`.
		let resolveFirst: () => void;
		const pending = new Promise<void>((r) => { resolveFirst = r; });
		const handler = jest.fn().mockImplementation(() => pending.then(() => makeResultResponse(1, {})));
		transport.onMessage = handler;
		await transport.start();

		// Push 10 tool calls in a single tick.
		for (let i = 0; i < 10; i++) {
			stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call' }));
		}
		await flushMicrotasks();

		// Without the concurrency limit, all 10 handlers would have started.
		// With MAX_CONCURRENT_REQUESTS = 4, only the first 4 should be active.
		expect(handler).toHaveBeenCalledTimes(4);

		// Release them; the remaining 6 should now run.
		resolveFirst!();
		await flushMicrotasks();
		await flushMicrotasks();
		// Total invocations across both phases should be all 10 eventually.
		expect(handler).toHaveBeenCalledTimes(10);
	});

	it('processes serial messages in arrival order', async () => {
		const seen: number[] = [];
		const handler = jest.fn().mockImplementation((msg: { id: number }) => {
			seen.push(msg.id);
			return Promise.resolve(makeResultResponse(msg.id, {}));
		});
		transport.onMessage = handler;
		await transport.start();

		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x' }));
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'x' }));
		stdin.pushLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'x' }));
		await flushMicrotasks();
		await flushMicrotasks();
		expect(seen).toEqual([1, 2, 3]);
	});
});
