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
	const result = resp.result as { content: { type: string; text: string }[]; isError?: boolean };
	return JSON.parse(result.content[0].text);
}

describe('MCP reaction tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('list_comment_reactions', () => {
		it('calls GET /repos/{o}/{r}/issues/comments/{id}/reactions', async () => {
			const mockReactions = [
				{ id: 1, user: { login: 'alice', avatar_url: 'https://x.com/a.png' }, reaction: '+1' },
				{ id: 2, user: { login: 'bob', avatar_url: 'https://x.com/b.png' }, reaction: 'heart' },
			];
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockReactions);

			const resp = await callTool('list_comment_reactions', {
				owner: 'foo', repo: 'bar', comment_id: 42,
			});

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/issues/comments/42/reactions',
			);
			expect(extractContent(resp)).toEqual(mockReactions);
		});

		it('URL-encodes owner and repo names', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_comment_reactions', {
				owner: 'with space', repo: 'name/with-slash', comment_id: 7,
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/with%20space/name%2Fwith-slash/issues/comments/7/reactions',
			);
		});

		it('requires comment_id argument (handler-throws via resolveNumber)', async () => {
			const resp = await callTool('list_comment_reactions', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/comment_id/i);
		});

		it('rejects non-integer comment_id', async () => {
			const resp = await callTool('list_comment_reactions', {
				owner: 'foo', repo: 'bar', comment_id: 'not-a-number',
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
		});

		it('wraps API errors as isError: true', async () => {
			(mockClient.rawRequest as jest.Mock).mockRejectedValue(new Error('HTTP 404: comment not found'));
			const resp = await callTool('list_comment_reactions', {
				owner: 'foo', repo: 'bar', comment_id: 999,
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});

		it('uses default owner/repo from config', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_comment_reactions', { comment_id: 1 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/default-owner/default-repo/issues/comments/1/reactions',
			);
		});
	});

	describe('list_issue_reactions', () => {
		it('calls GET /repos/{o}/{r}/issues/{number}/reactions', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([
				{ id: 1, user: { login: 'alice' }, reaction: 'heart' },
			]);
			const resp = await callTool('list_issue_reactions', {
				owner: 'foo', repo: 'bar', number: 5,
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/issues/5/reactions',
			);
			const payload = extractContent(resp) as unknown[];
			expect(payload).toHaveLength(1);
		});

		it('URL-encodes owner/repo', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_issue_reactions', {
				owner: 'org name', repo: 'repo.x', number: 3,
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/org%20name/repo.x/issues/3/reactions',
			);
		});

		it('requires number argument (handler-throws via resolveNumber)', async () => {
			const resp = await callTool('list_issue_reactions', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/number/i);
		});

		it('returns empty array as [] when no reactions', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			const resp = await callTool('list_issue_reactions', {
				owner: 'foo', repo: 'bar', number: 1,
			});
			expect(extractContent(resp)).toEqual([]);
		});
	});
});
