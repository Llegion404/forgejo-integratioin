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

/** Mock client exposing only the four SDK methods misc tools call. */
const mockClient: jest.Mocked<
	Pick<McpForgejoClient, 'listReleases' | 'getRelease' | 'getFileContents' | 'listTags'>
> = {
	listReleases: jest.fn(),
	getRelease: jest.fn(),
	getFileContents: jest.fn(),
	listTags: jest.fn(),
} as unknown as jest.Mocked<Pick<McpForgejoClient, 'listReleases' | 'getRelease' | 'getFileContents' | 'listTags'>>;

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
	const result = resp.result as { content: { text: string }[]; isError?: boolean };
	return JSON.parse(result.content[0].text);
}

describe('MCP misc tools', () => {
	beforeEach(() => jest.clearAllMocks());

	describe('list_releases', () => {
		it('calls listReleases(owner, repo) and returns Release[]', async () => {
			const mockReleases = [
				{ id: 1, tag_name: 'v1.0.0', name: 'First', body: 'changelog', draft: false, prerelease: false },
			];
			(mockClient.listReleases as jest.Mock).mockResolvedValue(mockReleases);

			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });

			expect(mockClient.listReleases).toHaveBeenCalledWith('foo', 'bar');
			expect(extractContent(resp)).toEqual(mockReleases);
		});

		it('returns empty array when no releases', async () => {
			(mockClient.listReleases as jest.Mock).mockResolvedValue([]);
			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });
			expect(extractContent(resp)).toEqual([]);
		});

		it('uses default owner/repo from config', async () => {
			(mockClient.listReleases as jest.Mock).mockResolvedValue([]);
			await callTool('list_releases', {});
			expect(mockClient.listReleases).toHaveBeenCalledWith('default-owner', 'default-repo');
		});

		it('wraps API errors as isError: true', async () => {
			(mockClient.listReleases as jest.Mock).mockRejectedValue(new Error('HTTP 500'));
			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
		});
	});

	describe('get_release', () => {
		it('calls getRelease(owner, repo, id) with numeric id', async () => {
			const mockRelease = { id: 5, tag_name: 'v2.0', name: 'Second', body: '', draft: false, prerelease: false };
			(mockClient.getRelease as jest.Mock).mockResolvedValue(mockRelease);

			const resp = await callTool('get_release', { owner: 'foo', repo: 'bar', id: 5 });

			expect(mockClient.getRelease).toHaveBeenCalledWith('foo', 'bar', 5);
			expect(extractContent(resp)).toEqual(mockRelease);
		});

		it('accepts string-coercible numeric id', async () => {
			(mockClient.getRelease as jest.Mock).mockResolvedValue({ id: 7 });
			await callTool('get_release', { owner: 'foo', repo: 'bar', id: '7' });
			// resolveNumber should coerce the string '7' to integer 7
			expect(mockClient.getRelease).toHaveBeenCalledWith('foo', 'bar', 7);
		});

		it('rejects non-numeric id', async () => {
			const resp = await callTool('get_release', { owner: 'foo', repo: 'bar', id: 'abc' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
		});

		it('requires id argument (handler-throws via resolveNumber)', async () => {
			const resp = await callTool('get_release', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/id/i);
		});
	});

	describe('get_file_contents', () => {
		it('calls getFileContents(owner, repo, path, ref) in correct order', async () => {
			(mockClient.getFileContents as jest.Mock).mockResolvedValue('# Test Repo\n\nA README.');

			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'README.md', ref: 'main',
			});

			expect(mockClient.getFileContents).toHaveBeenCalledWith('foo', 'bar', 'README.md', 'main');
			// get_file_contents returns a raw string (not a JSON object), so the
			// server's text content is the file content verbatim — no JSON.parse.
			const result = resp.result as { content: { text: string }[] };
			expect(result.content[0].text).toBe('# Test Repo\n\nA README.');
		});

		it('passes through file paths containing slashes', async () => {
			(mockClient.getFileContents as jest.Mock).mockResolvedValue('src code');
			await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'src/index.ts', ref: 'main',
			});
			expect(mockClient.getFileContents).toHaveBeenCalledWith('foo', 'bar', 'src/index.ts', 'main');
		});

		it('accepts a commit SHA as ref', async () => {
			(mockClient.getFileContents as jest.Mock).mockResolvedValue('content');
			await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'file.txt', ref: '0'.repeat(40),
			});
			expect(mockClient.getFileContents).toHaveBeenCalledWith('foo', 'bar', 'file.txt', '0'.repeat(40));
		});

		it('requires ref argument (handler-throws via resolveOwner when only path given)', async () => {
			// `path` is required at schema level, so {owner,repo,path} passes validation.
			// But `ref` is also required at schema level — wait, ref IS in required[] list.
			// So {owner,repo,path} missing ref SHOULD fail schema validation.
			const resp = await callTool('get_file_contents', { owner: 'foo', repo: 'bar', path: 'README.md' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/ref/i);
		});

		it('wraps 404 errors as isError: true', async () => {
			(mockClient.getFileContents as jest.Mock).mockRejectedValue(
				new Error('HTTP 404: file not found'),
			);
			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'nope.md', ref: 'main',
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});
	});

	describe('list_tags', () => {
		it('calls listTags(owner, repo) and returns Tag[]', async () => {
			const mockTags = [
				{ name: 'v1.0', id: 'abc', message: 'release 1.0', commit: { sha: 'def', url: '' } },
				{ name: 'v0.9', id: 'xyz', message: 'release 0.9', commit: { sha: '123', url: '' } },
			];
			(mockClient.listTags as jest.Mock).mockResolvedValue(mockTags);

			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });

			expect(mockClient.listTags).toHaveBeenCalledWith('foo', 'bar');
			expect(extractContent(resp)).toEqual(mockTags);
		});

		it('returns empty array when repo has no tags', async () => {
			(mockClient.listTags as jest.Mock).mockResolvedValue([]);
			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
			expect(extractContent(resp)).toEqual([]);
		});

		it('uses default owner/repo from config', async () => {
			(mockClient.listTags as jest.Mock).mockResolvedValue([]);
			await callTool('list_tags', {});
			expect(mockClient.listTags).toHaveBeenCalledWith('default-owner', 'default-repo');
		});

		it('wraps API errors as isError: true', async () => {
			(mockClient.listTags as jest.Mock).mockRejectedValue(new Error('HTTP 403: forbidden'));
			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 403');
		});
	});
});
