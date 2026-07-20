/**
 * Tests for the v2 workflow / Actions MCP tools (6 tools).
 *
 * Mirrors the style of misc.test.ts: mock client exposes rawRequest +
 * getWorkflowLogs; each tool is invoked via the JSON-RPC dispatcher.
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

const mockClient: jest.Mocked<Pick<McpForgejoClient, 'rawRequest' | 'getWorkflowLogs'>> = {
	rawRequest: jest.fn(),
	getWorkflowLogs: jest.fn(),
} as unknown as jest.Mocked<Pick<McpForgejoClient, 'rawRequest' | 'getWorkflowLogs'>>;

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

describe('MCP workflow tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('list_workflows', () => {
		it('calls GET /repos/{o}/{r}/actions/workflows with page params', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([
				{ id: 1, name: 'CI', path: '.forgejo/workflows/ci.yml', state: 'active' },
			]);
			await callTool('list_workflows', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/actions\/workflows\?page=1&limit=30/),
			);
		});

		it('wraps response in items + pagination envelope', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
			const resp = await callTool('list_workflows', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: unknown[]; _meta: { pagination: { returned: number } } };
			expect(payload.items).toHaveLength(2);
			expect(payload._meta.pagination.returned).toBe(2);
		});

		it('uses default owner/repo from config', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_workflows', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/default-owner\/default-repo\/actions\/workflows/),
			);
		});
	});

	describe('list_workflow_runs', () => {
		it('builds filter params for status + branch', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ workflow_runs: [], total_count: 0 });
			await callTool('list_workflow_runs', {
				owner: 'foo', repo: 'bar', status: 'failure', branch: 'main',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/actions\/tasks\?status=failure&branch=main/),
			);
		});

		it('returns paginated slice when more items than page_size', async () => {
			const many = Array.from({ length: 60 }, (_, i) => ({ id: i, name: `Run ${i}` }));
			mockClient.rawRequest.mockResolvedValueOnce({ workflow_runs: many, total_count: 60 });
			const resp = await callTool('list_workflow_runs', {
				owner: 'foo', repo: 'bar', page: 2, page_size: 30,
			});
			const payload = extractContent(resp) as { items: { id: number }[]; total_count: number };
			expect(payload.items).toHaveLength(30);
			expect(payload.items[0].id).toBe(30); // page 2 starts at index 30
			expect(payload.total_count).toBe(60);
		});

		it('handles missing workflow_runs field gracefully', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({}); // malformed
			const resp = await callTool('list_workflow_runs', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual([]);
		});

		it('works without any filters', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ workflow_runs: [] });
			await callTool('list_workflow_runs', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/actions\/tasks$/),
			);
		});
	});

	describe('get_workflow_run', () => {
		it('calls GET /repos/{o}/{r}/actions/runs/{id}', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ id: 42, status: 'success' });
			await callTool('get_workflow_run', { owner: 'foo', repo: 'bar', id: 42 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo/bar/actions/runs/42');
		});

		it('rejects missing id', async () => {
			const resp = await callTool('get_workflow_run', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'id'/);
		});

		it('rejects id < 1', async () => {
			const resp = await callTool('get_workflow_run', { owner: 'foo', repo: 'bar', id: 0 });
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});
	});

	describe('get_workflow_jobs', () => {
		it('calls GET /repos/{o}/{r}/actions/runs/{id}/jobs and paginates client-side', async () => {
			const allJobs = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `Job ${i}` }));
			mockClient.rawRequest.mockResolvedValueOnce({ jobs: allJobs, total_count: 40 });
			const resp = await callTool('get_workflow_jobs', {
				owner: 'foo', repo: 'bar', id: 99, page: 1, page_size: 10,
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo/bar/actions/runs/99/jobs');
			const payload = extractContent(resp) as { items: unknown[]; total_count: number };
			expect(payload.items).toHaveLength(10);
			expect(payload.total_count).toBe(40);
		});

		it('requires id argument', async () => {
			const resp = await callTool('get_workflow_jobs', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'id'/);
		});
	});

	describe('get_workflow_logs', () => {
		it('calls SDK getWorkflowLogs with run_number and default job_ref=0', async () => {
			mockClient.getWorkflowLogs.mockResolvedValueOnce('line 1\nline 2\n');
			const resp = await callTool('get_workflow_logs', {
				owner: 'foo', repo: 'bar', run_number: 42,
			});
			expect(mockClient.getWorkflowLogs).toHaveBeenCalledWith('foo', 'bar', 42, 0);
			const payload = extractContent(resp) as { content: string; truncated: boolean };
			expect(payload.content).toBe('line 1\nline 2\n');
			expect(payload.truncated).toBe(false);
		});

		it('passes explicit job_ref through', async () => {
			mockClient.getWorkflowLogs.mockResolvedValueOnce('');
			await callTool('get_workflow_logs', { owner: 'foo', repo: 'bar', run_number: 7, job_ref: 3 });
			expect(mockClient.getWorkflowLogs).toHaveBeenCalledWith('foo', 'bar', 7, 3);
		});

		it('truncates logs over 200 KB', async () => {
			const huge = 'x'.repeat(300_000);
			mockClient.getWorkflowLogs.mockResolvedValueOnce(huge);
			const resp = await callTool('get_workflow_logs', {
				owner: 'foo', repo: 'bar', run_number: 1,
			});
			const payload = extractContent(resp) as {
				content: string; truncated: boolean; original_length: number; warning: string;
			};
			expect(payload.truncated).toBe(true);
			expect(payload.original_length).toBe(300_000);
			expect(payload.content.length).toBeLessThan(300_000);
			expect(payload.warning).toMatch(/truncated/i);
		});

		it('requires run_number argument', async () => {
			const resp = await callTool('get_workflow_logs', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/run_number/);
		});
	});

	describe('list_workflow_artifacts', () => {
		it('calls GET /repos/{o}/{r}/actions/runs/{id}/artifacts', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({
				artifacts: [{ id: 1, name: 'dist.zip', size_in_bytes: 4096 }],
				total_count: 1,
			});
			const resp = await callTool('list_workflow_artifacts', {
				owner: 'foo', repo: 'bar', id: 42,
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo/bar/actions/runs/42/artifacts');
			const payload = extractContent(resp) as { items: { name: string }[] };
			expect(payload.items[0].name).toBe('dist.zip');
		});

		it('requires id argument', async () => {
			const resp = await callTool('list_workflow_artifacts', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'id'/);
		});
	});
});
