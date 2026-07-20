/**
 * Tests for the v2 repo-navigation MCP tools (4 tools).
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

describe('MCP repo-navigation tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('list_repo_branches', () => {
		it('calls GET /repos/{o}/{r}/branches with pagination params', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([
				{ name: 'main', commit: { id: 'a'.repeat(40) }, protected: true },
				{ name: 'dev', commit: { id: 'b'.repeat(40) }, protected: false },
			]);
			await callTool('list_repo_branches', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/branches\?page=1&limit=30/),
			);
		});

		it('wraps response in items + pagination', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([{ name: 'main' }]);
			const resp = await callTool('list_repo_branches', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: { name: string }[] };
			expect(payload.items[0].name).toBe('main');
		});

		it('uses default owner/repo', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_branches', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/default-owner\/default-repo\/branches/),
			);
		});
	});

	describe('get_branch', () => {
		it('calls GET /repos/{o}/{r}/branches/{branch}', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ name: 'main', protected: true });
			await callTool('get_branch', { owner: 'foo', repo: 'bar', branch: 'main' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo/bar/branches/main');
		});

		it('URL-encodes slashes in branch name', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({});
			await callTool('get_branch', { owner: 'foo', repo: 'bar', branch: 'release/1.0' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET', '/repos/foo/bar/branches/release%2F1.0',
			);
		});

		it('requires branch argument', async () => {
			const resp = await callTool('get_branch', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});
	});

	describe('list_repo_commits', () => {
		it('calls GET /repos/{o}/{r}/commits with no filters by default', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_commits', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/commits\?page=1&limit=30/),
			);
		});

		it('passes sha filter', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_commits', { owner: 'foo', repo: 'bar', sha: 'main' });
			const calledPath = mockClient.rawRequest.mock.calls[0][1] as string;
			expect(calledPath).toContain('sha=main');
		});

		it('passes path filter (URL-encoded)', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_commits', { owner: 'foo', repo: 'bar', path: 'src/a.ts' });
			const calledPath = mockClient.rawRequest.mock.calls[0][1] as string;
			expect(calledPath).toContain('path=src%2Fa.ts');
		});
	});

	describe('compare_commits', () => {
		it('calls GET /repos/{o}/{r}/compare/{base}...{head}', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ commits: [], files: [] });
			await callTool('compare_commits', {
				owner: 'foo', repo: 'bar', base: 'main', head: 'feature',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/compare/main...feature',
			);
		});

		it('URL-encodes refs with slashes', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({});
			await callTool('compare_commits', {
				owner: 'foo', repo: 'bar', base: 'release/1.0', head: 'feature/x',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/compare/release%2F1.0...feature%2Fx',
			);
		});

		it('requires both base and head', async () => {
			const resp = await callTool('compare_commits', { owner: 'foo', repo: 'bar', base: 'main' });
			const result = resp.result as { isError: boolean };
			expect(result.isError).toBe(true);
		});
	});
});
