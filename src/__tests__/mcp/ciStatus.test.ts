import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig } from '../../mcp/config';
import { McpForgejoClient } from '../../mcp/client';
import { mockDuplicateStatuses, mockMixedStatuses } from '../fixtures/commitStatuses';

const config: McpInstanceConfig = {
	instanceUrl: 'https://git.example.com',
	token: 'test-tok',
	defaultOwner: 'default-owner',
	defaultRepo: 'default-repo',
};

/** Mock client exposing only the methods ciStatus tools call. */
const mockClient: jest.Mocked<Pick<McpForgejoClient, 'getPullRequest' | 'rawRequest'>> = {
	getPullRequest: jest.fn(),
	rawRequest: jest.fn(),
} as unknown as jest.Mocked<Pick<McpForgejoClient, 'getPullRequest' | 'rawRequest'>>;

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

describe('MCP ciStatus tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('get_pr_ci_status', () => {
		it('resolves head SHA from PR, fetches + dedups statuses, returns summary', async () => {
			(mockClient.getPullRequest as jest.Mock).mockResolvedValue({
				number: 1,
				head: { sha: 'abc1234567890123456789012345678901234567', ref: 'feature-branch' },
				base: { ref: 'main' },
			});
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockDuplicateStatuses);

			const resp = await callTool('get_pr_ci_status', { owner: 'foo', repo: 'bar', number: 1 });

			expect(mockClient.getPullRequest).toHaveBeenCalledWith('foo', 'bar', 1);
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/statuses\/abc1234567890123456789012345678901234567\?page=1&limit=50/),
			);
			const payload = extractContent(resp) as {
				head_sha: string; head_branch: string; statuses: unknown[]; summary: string;
			};
			expect(payload.head_sha).toBe('abc1234567890123456789012345678901234567');
			expect(payload.head_branch).toBe('feature-branch');
			expect(payload.statuses).toHaveLength(6);
			expect(payload.summary).toBe('fail');
		});

		it('returns summary "none" when PR has no head SHA', async () => {
			(mockClient.getPullRequest as jest.Mock).mockResolvedValue({
				number: 2, head: { sha: '', ref: 'empty' }, base: { ref: 'main' },
			});
			// rawRequest should NOT be called when sha is empty
			const resp = await callTool('get_pr_ci_status', { owner: 'foo', repo: 'bar', number: 2 });
			expect(mockClient.rawRequest).not.toHaveBeenCalled();
			const payload = extractContent(resp) as { summary: string; statuses: unknown[] };
			expect(payload.summary).toBe('none');
			expect(payload.statuses).toHaveLength(0);
		});

		it('returns summary "pass" when all statuses are success', async () => {
			(mockClient.getPullRequest as jest.Mock).mockResolvedValue({
				number: 3, head: { sha: 'a'.repeat(40), ref: 'good' }, base: { ref: 'main' },
			});
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(
				mockDuplicateStatuses.filter((s) => s.status === 'success'),
			);
			const resp = await callTool('get_pr_ci_status', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = extractContent(resp) as { summary: string };
			expect(payload.summary).toBe('pass');
		});

		it('wraps PR fetch errors as isError: true', async () => {
			(mockClient.getPullRequest as jest.Mock).mockRejectedValue(new Error('HTTP 404: not found'));
			const resp = await callTool('get_pr_ci_status', { owner: 'foo', repo: 'bar', number: 999 });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});

		it('uses default owner/repo from config when args omit them', async () => {
			(mockClient.getPullRequest as jest.Mock).mockResolvedValue({
				number: 1, head: { sha: 'x'.repeat(40), ref: 'f' }, base: { ref: 'm' },
			});
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('get_pr_ci_status', { number: 1 });
			expect(mockClient.getPullRequest).toHaveBeenCalledWith('default-owner', 'default-repo', 1);
		});

		it('requires number argument', async () => {
			const resp = await callTool('get_pr_ci_status', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'number'/);
		});
	});

	describe('get_commit_statuses', () => {
		it('fetches statuses by raw SHA and deduplicates', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockDuplicateStatuses);
			const sha = '0'.repeat(40);
			const resp = await callTool('get_commit_statuses', { owner: 'foo', repo: 'bar', sha });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/statuses\/0{40}\?page=1&limit=30/),
			);
			const payload = extractContent(resp) as { sha: string; statuses: unknown[]; summary: string };
			expect(payload.sha).toBe(sha);
			expect(payload.statuses).toHaveLength(6);
			expect(payload.summary).toBe('fail');
		});

		it('returns "none" for empty status list', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			const resp = await callTool('get_commit_statuses', { owner: 'foo', repo: 'bar', sha: '0'.repeat(40) });
			const payload = extractContent(resp) as { summary: string; statuses: unknown[] };
			expect(payload.summary).toBe('none');
			expect(payload.statuses).toHaveLength(0);
		});

		it('returns "fail" when mixed statuses include a failure', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockMixedStatuses);
			const resp = await callTool('get_commit_statuses', { owner: 'foo', repo: 'bar', sha: '0'.repeat(40) });
			const payload = extractContent(resp) as { summary: string };
			expect(payload.summary).toBe('fail');
		});

		it('rejects SHA shorter than 40 chars', async () => {
			const resp = await callTool('get_commit_statuses', { owner: 'foo', repo: 'bar', sha: 'short' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("'sha'");
		});

		it('wraps rawRequest errors as isError: true', async () => {
			(mockClient.rawRequest as jest.Mock).mockRejectedValue(new Error('HTTP 404: commit not found'));
			const resp = await callTool('get_commit_statuses', { owner: 'foo', repo: 'bar', sha: '0'.repeat(40) });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});
	});
});
