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

describe('MCP branch protection tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('list_branch_protections', () => {
		it('calls GET /repos/{o}/{r}/branch_protections', async () => {
			const mockRules = [{ rule_name: 'main', enable_push: false }];
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockRules);

			const resp = await callTool('list_branch_protections', { owner: 'foo', repo: 'bar' });

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/branch_protections',
			);
			const result = resp.result as { content: { text: string }[] };
			expect(JSON.parse(result.content[0].text)).toEqual(mockRules);
		});

		it('returns empty array when no protections exist', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			const resp = await callTool('list_branch_protections', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { content: { text: string }[] };
			expect(JSON.parse(result.content[0].text)).toEqual([]);
		});

		it('URL-encodes owner and repo', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_branch_protections', { owner: 'org/team', repo: 're po' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/org%2Fteam/re%20po/branch_protections',
			);
		});

		it('uses default owner/repo from config', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_branch_protections', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/default-owner/default-repo/branch_protections',
			);
		});

		it('fails when no owner/repo in args and no config defaults', async () => {
			// owner/repo are optional at schema level (allow config fallback).
			// When both args and config defaults are empty, the handler throws
			// via resolveOwner() with a clear "'owner' is required" message.
			const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
			buildMcpServer(fakeTransport, () => mockClient as unknown as McpForgejoClient, () => ({
				...config,
				defaultOwner: '',   // clear defaults so test exercises the no-owner path
				defaultRepo: '',
			}));
			const resp = await fakeTransport.onMessage!({
				jsonrpc: '2.0', id: 1, method: 'tools/call',
				params: { name: 'list_branch_protections', arguments: {} },
			} as JsonRpcRequest) as JsonRpcResponse;
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'((owner)|(repo))' is required/i);
		});
	});

	describe('get_branch_protection', () => {
		it('calls GET /repos/{o}/{r}/branch_protections/{branch}', async () => {
			const mockRule = { rule_name: 'main', enable_push: false, required_approvals: 2 };
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockRule);

			const resp = await callTool('get_branch_protection', {
				owner: 'foo', repo: 'bar', branch: 'main',
			});

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/branch_protections/main',
			);
			const result = resp.result as { content: { text: string }[] };
			expect(JSON.parse(result.content[0].text)).toEqual(mockRule);
		});

		it('URL-encodes branch names containing slashes', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue({});
			await callTool('get_branch_protection', {
				owner: 'foo', repo: 'bar', branch: 'release/1.0',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/branch_protections/release%2F1.0',
			);
		});

		it('URL-encodes special chars in branch name', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue({});
			await callTool('get_branch_protection', {
				owner: 'foo', repo: 'bar', branch: 'feature branch?',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/branch_protections/feature%20branch%3F',
			);
		});

		it('requires branch argument (handler-throws when absent)', async () => {
			const resp = await callTool('get_branch_protection', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/branch/i);
		});

		it('wraps 404 errors as isError: true', async () => {
			(mockClient.rawRequest as jest.Mock).mockRejectedValue(
				new Error('HTTP 404: branch protection rule not found'),
			);
			const resp = await callTool('get_branch_protection', {
				owner: 'foo', repo: 'bar', branch: 'nonexistent',
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});
	});
});
