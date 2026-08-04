/**
 * Tests for the v2 search MCP tools (3 tools: issues, code, users).
 */

import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig } from '../../mcp/config';
import { McpForgejoClient } from '../../mcp/client';

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

function extractContent(resp: JsonRpcResponse): unknown {
	const result = resp.result as { content: { text: string }[] };
	return JSON.parse(result.content[0].text);
}

describe('MCP search tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('search_issues', () => {
		it('rejects when query missing', async () => {
			const resp = await callTool('search_issues', {});
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});

		it('builds minimal query when only query given', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('search_issues', { query: 'memory leak' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/issues\/search\?q=memory%20leak&page=1&limit=30/),
			);
		});

		it('encodes all filter parameters', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('search_issues', {
				query: 'panic',
				state: 'open',
				type: 'issues',
				assignee: 'alice',
				author: 'bob',
				labels: 'bug,urgent',
				milestone: 'v2',
				owner: 'acme',
				repo: 'widget',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringContaining('q=panic'),
			);
			const calledPath = mockClient.rawRequest.mock.calls[0][1] as string;
			expect(calledPath).toContain('state=open');
			expect(calledPath).toContain('type=issues');
			expect(calledPath).toContain('assigned=alice');
			expect(calledPath).toContain('created=bob');
			expect(calledPath).toContain('labels=bug%2Curgent');
			expect(calledPath).toContain('milestone=v2');
			expect(calledPath).toContain('owner=acme');
			expect(calledPath).toContain('repo=widget');
		});

		it('returns paginated envelope', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([{ id: 1, number: 1, title: 't' }]);
			const resp = await callTool('search_issues', { query: 'x' });
			const payload = extractContent(resp) as { items: unknown[]; _meta: { pagination: { returned: number } } };
			expect(payload.items).toHaveLength(1);
			expect(payload._meta.pagination.returned).toBe(1);
		});

		it('treats indexer-disabled 404 as empty result with a warning, not an error', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
			const resp = await callTool('search_issues', { query: 'x' });
			const result = resp.result as { isError?: boolean };
			expect(result.isError).toBeFalsy();
			const payload = extractContent(resp) as { items: unknown[]; _meta: { warnings?: string[] } };
			expect(payload.items).toEqual([]);
			expect(payload._meta.warnings?.[0]).toMatch(/indexer/i);
		});

		it('propagates non-404 search errors as isError', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
			const resp = await callTool('search_issues', { query: 'x' });
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});
	});

	describe('search_code', () => {
		it('rejects when query missing', async () => {
			const resp = await callTool('search_code', {});
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});

		it('builds code-search path with filters', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ data: [{ path: 'src/a.ts', name: 'a.ts' }] });
			await callTool('search_code', {
				query: 'function parseJson',
				owner: 'foo',
				repo: 'bar',
			});
			const calledPath = mockClient.rawRequest.mock.calls[0][1] as string;
			expect(calledPath).toMatch(/\/code\/search\?/);
			expect(calledPath).toContain('q=function%20parseJson');
			expect(calledPath).toContain('owner=foo');
			expect(calledPath).toContain('repo=bar');
		});

		it('paginates client-side from the data array', async () => {
			const many = Array.from({ length: 60 }, (_, i) => ({ path: `f${i}.ts` }));
			mockClient.rawRequest.mockResolvedValueOnce({ data: many });
			const resp = await callTool('search_code', {
				query: 'x', page: 2, page_size: 20,
			});
			const payload = extractContent(resp) as { items: unknown[]; total_count: number };
			expect(payload.items).toHaveLength(20);
			expect(payload.total_count).toBe(60);
		});

		it('handles malformed response (missing data field)', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({});
			const resp = await callTool('search_code', { query: 'x' });
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual([]);
		});

		it('treats indexer-disabled 404 as empty result with a warning, not an error', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
			const resp = await callTool('search_code', { query: 'x' });
			const result = resp.result as { isError?: boolean };
			expect(result.isError).toBeFalsy();
			const payload = extractContent(resp) as { items: unknown[]; _meta: { warnings?: string[] } };
			expect(payload.items).toEqual([]);
			expect(payload._meta.warnings?.[0]).toMatch(/indexer/i);
		});
	});

	describe('search_users', () => {
		it('rejects when query missing', async () => {
			const resp = await callTool('search_users', {});
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});

		it('builds user-search path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ data: [{ id: 1, login: 'alice' }] });
			await callTool('search_users', { query: 'alice' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/users\/search\?q=alice/),
			);
		});

		it('returns paginated items envelope', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ data: [{ login: 'alice' }, { login: 'bob' }] });
			const resp = await callTool('search_users', { query: 'a' });
			const payload = extractContent(resp) as { items: { login: string }[] };
			expect(payload.items.map((u) => u.login)).toEqual(['alice', 'bob']);
		});
	});
});
