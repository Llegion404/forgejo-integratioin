/**
 * Structured HTTP error translation tests.
 *
 * Phase A.2 changed the server's tools/call dispatcher to detect
 * ForgejoApiError and emit a structured second content block with
 * `http_status`, `http_status_text`, `response_body`, and `rate_limited`
 * fields — so agents can programmatically branch on status codes without
 * regex on the human-readable error message.
 *
 * Also tests the 429 rate-limit retry: a single 429 response is retried
 * once after a fixed 1s backoff; subsequent failures surface as isError.
 */

import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig } from '../../mcp/config';
import { McpForgejoClient } from '../../mcp/client';
import { ForgejoApiError, ForgejoNetworkError } from 'forgejo-ts';

jest.useFakeTimers({ doNotFake: ['nextTick'] });

const config: McpInstanceConfig = {
	instanceUrl: 'https://git.example.com',
	token: 'test-tok',
	defaultOwner: 'default-owner',
	defaultRepo: 'default-repo',
};

const mockClient: jest.Mocked<Pick<McpForgejoClient, 'rawRequest'>> = {
	rawRequest: jest.fn(),
} as unknown as jest.Mocked<Pick<McpForgejoClient, 'rawRequest'>>;

async function callTool(name: string, args: unknown): Promise<JsonRpcResponse> {
	const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
	buildMcpServer(fakeTransport, () => mockClient as unknown as McpForgejoClient, () => config);
	const handler = fakeTransport.onMessage!;
	const result = await handler({
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args },
	} as JsonRpcRequest);
	return result as JsonRpcResponse;
}

describe('MCP structured error translation', () => {
	beforeEach(() => jest.clearAllMocks());

	it('translates ForgejoApiError into two content blocks (text + structured JSON)', async () => {
		mockClient.rawRequest.mockRejectedValueOnce(
			new ForgejoApiError(404, 'Not Found', '{"message":"issue not found"}'),
		);
		const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
		const result = resp.result as { isError: boolean; content: { type: string; text: string }[] };
		expect(result.isError).toBe(true);
		expect(result.content).toHaveLength(2);
		// First block: human-readable text.
		expect(result.content[0].text).toMatch(/HTTP 404/);
		// Second block: structured JSON.
		const structured = JSON.parse(result.content[1].text);
		expect(structured).toEqual({
			tool: 'list_tags',
			error_kind: 'http',
			http_status: 404,
			http_status_text: 'Not Found',
			response_body: '{"message":"issue not found"}',
			rate_limited: false,
		});
	});

	it('flags rate_limited=true on HTTP 429', async () => {
		// Both attempts return 429 — final result is isError.
		mockClient.rawRequest.mockRejectedValueOnce(new ForgejoApiError(429, 'Too Many Requests', 'rate limited'));
		mockClient.rawRequest.mockRejectedValueOnce(new ForgejoApiError(429, 'Too Many Requests', 'rate limited'));
		const promise = callTool('list_tags', { owner: 'foo', repo: 'bar' });
		// Advance the 1-second retry timer.
		await jest.advanceTimersByTimeAsync(1500);
		const resp = await promise;
		const result = resp.result as { isError: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		const structured = JSON.parse(result.content[1].text);
		expect(structured.rate_limited).toBe(true);
		expect(structured.http_status).toBe(429);
	});

	it('retries once on 429 then succeeds if the second attempt works', async () => {
		mockClient.rawRequest.mockRejectedValueOnce(new ForgejoApiError(429, 'Too Many Requests', 'slow down'));
		mockClient.rawRequest.mockResolvedValueOnce([{ name: 'v1.0' }]); // retry succeeds
		const promise = callTool('list_tags', { owner: 'foo', repo: 'bar' });
		await jest.advanceTimersByTimeAsync(1500);
		const resp = await promise;
		const result = resp.result as { isError?: boolean; content: { text: string }[] };
		expect(result.isError ?? false).toBe(false);
		const payload = JSON.parse(result.content[0].text);
		expect(payload.items[0].name).toBe('v1.0');
		expect(mockClient.rawRequest).toHaveBeenCalledTimes(2);
	});

	it('does not retry on non-429 errors (e.g. 500)', async () => {
		mockClient.rawRequest.mockRejectedValueOnce(new ForgejoApiError(500, 'Internal Server Error', 'oops'));
		const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
		const result = resp.result as { isError: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		expect(mockClient.rawRequest).toHaveBeenCalledTimes(1); // no retry
		const structured = JSON.parse(result.content[1].text);
		expect(structured.http_status).toBe(500);
		expect(structured.rate_limited).toBe(false);
	});

	it('translates ForgejoNetworkError into structured network-error envelope', async () => {
		const cause = new Error('ENOTFOUND git.example.com');
		mockClient.rawRequest.mockRejectedValueOnce(new ForgejoNetworkError('https://git.example.com/api/v1/repos/foo/bar/tags', cause));
		const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
		const result = resp.result as { isError: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		const structured = JSON.parse(result.content[1].text);
		expect(structured).toEqual({
			tool: 'list_tags',
			error_kind: 'network',
			url: 'https://git.example.com/api/v1/repos/foo/bar/tags',
			cause: 'ENOTFOUND git.example.com',
		});
	});

	it('falls back to plain text content for unknown error types', async () => {
		mockClient.rawRequest.mockRejectedValueOnce(new Error('something weird happened'));
		const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
		const result = resp.result as { isError: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		expect(result.content).toHaveLength(1); // no structured second block
		expect(result.content[0].text).toMatch(/something weird happened/);
	});
});
