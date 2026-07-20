import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig } from '../../mcp/config';
import { McpForgejoClient } from '../../mcp/client';
import { ForgejoApiError } from 'forgejo-ts';

const config: McpInstanceConfig = {
	instanceUrl: 'https://git.example.com',
	token: 'test-tok',
	defaultOwner: 'default-owner',
	defaultRepo: 'default-repo',
};

/**
 * Mock client exposing the surface our rewritten misc tools actually use:
 * - getRelease (single fetch; unchanged)
 * - rawRequest (list_releases, list_tags, get_file_contents all paginate via rawRequest now)
 */
const mockClient: jest.Mocked<Pick<McpForgejoClient, 'getRelease' | 'rawRequest'>> = {
	getRelease: jest.fn(),
	rawRequest: jest.fn(),
} as unknown as jest.Mocked<Pick<McpForgejoClient, 'getRelease' | 'rawRequest'>>;

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
		it('calls rawRequest with paged releases path: full=true returns raw SDK payload', async () => {
			const mockReleases = [
				{
					id: 1, tag_name: 'v1.0.0', name: 'First', body: 'changelog',
					draft: false, prerelease: false, author: { login: 'a', avatar_url: 'http://x' },
					created_at: '2025-01-01T00:00:00Z', published_at: '2025-01-02T00:00:00Z',
					html_url: 'http://rel/1', tarball_url: 'tb', zipball_url: 'zb',
					assets: [{ id: 11, name: 'asset.zip', size: 999, download_count: 3, browser_download_url: 'http://dl' }],
				},
			];
			mockClient.rawRequest.mockResolvedValueOnce(mockReleases);

			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar', full: true });

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/releases\?page=1&limit=30/),
			);
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual(mockReleases);
		});

		it('default (full=false) returns compact summaries: bounded body, compact author, assets reduced', async () => {
			const longBody = 'x'.repeat(5000);
			const mockReleases = [
				{
					id: 1, tag_name: 'v1.0.0', name: 'First', body: longBody,
					draft: false, prerelease: false,
					author: { login: 'alice', avatar_url: 'http://x', full_name: 'Alice' },
					created_at: '2025-01-01T00:00:00Z', published_at: '2025-01-02T00:00:00Z',
					html_url: 'http://rel/1', tarball_url: 'tb', zipball_url: 'zb',
					assets: [{ id: 11, name: 'asset.zip', size: 999, download_count: 3, browser_download_url: 'http://dl' }],
				},
			];
			mockClient.rawRequest.mockResolvedValueOnce(mockReleases);

			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: Array<Record<string, unknown>> };

			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].id).toBe(1);
			expect(payload.items[0].tag_name).toBe('v1.0.0');
			expect((payload.items[0].body as { truncated: boolean; original_length: number }).truncated).toBe(true);
			expect((payload.items[0].body as { original_length: number }).original_length).toBe(5000);
			expect(payload.items[0].author).toEqual({ login: 'alice', full_name: 'Alice' });
			expect(payload.items[0].assets).toEqual([{ name: 'asset.zip', size: 999, id: 11, download_count: 3 }]);
			expect(payload.items[0]).not.toHaveProperty('tarball_url');
			expect(payload.items[0]).not.toHaveProperty('zipball_url');
			expect((payload.items[0].author as Record<string, unknown>).avatar_url).toBeUndefined();
		});

		it('returns empty items array when no releases', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual([]);
		});

		it('uses default owner/repo from config', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_releases', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/default-owner\/default-repo\/releases/),
			);
		});

		it('wraps API errors as isError: true', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(new Error('HTTP 500'));
			const resp = await callTool('list_releases', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
		});
	});

	describe('get_release', () => {
		it('calls getRelease(owner, repo, id): full=true returns raw SDK payload unchanged', async () => {
			const mockRelease = {
				id: 5, tag_name: 'v2.0', name: 'Second', body: 'changelog',
				draft: false, prerelease: false, author: { login: 'a', avatar_url: 'http://x' },
				created_at: '2025-01-01T00:00:00Z', published_at: '2025-01-02T00:00:00Z',
				html_url: 'http://rel/5', tarball_url: 'tb', zipball_url: 'zb', assets: [],
			};
			mockClient.getRelease.mockResolvedValueOnce(mockRelease as never);

			const resp = await callTool('get_release', { owner: 'foo', repo: 'bar', id: 5, full: true });

			expect(mockClient.getRelease).toHaveBeenCalledWith('foo', 'bar', 5);
			expect(extractContent(resp)).toEqual(mockRelease);
		});

		it('default (full=false) returns compact shape — author reduced, body bounded, tarball_url dropped', async () => {
			const longBody = 'y'.repeat(3000);
			mockClient.getRelease.mockResolvedValueOnce({
				id: 5, tag_name: 'v2.0', name: 'Second', body: longBody,
				draft: false, prerelease: false,
				author: { login: 'alice', avatar_url: 'http://x', full_name: 'Alice Liddell' },
				created_at: '2025-01-01T00:00:00Z', published_at: '2025-01-02T00:00:00Z',
				html_url: 'http://rel/5', tarball_url: 'tb', zipball_url: 'zb',
				assets: [{ id: 1, name: 'bin', size: 50, download_count: 0, browser_download_url: 'http://d' }],
			} as never);

			const resp = await callTool('get_release', { owner: 'foo', repo: 'bar', id: 5 });
			const payload = extractContent(resp) as Record<string, unknown>;

			expect(mockClient.getRelease).toHaveBeenCalledWith('foo', 'bar', 5);
			expect(payload.id).toBe(5);
			expect(payload.tag_name).toBe('v2.0');
			expect((payload.body as { truncated: boolean }).truncated).toBe(true);
			expect(payload.author).toEqual({ login: 'alice', full_name: 'Alice Liddell' });
			expect(payload).not.toHaveProperty('tarball_url');
			expect(payload).not.toHaveProperty('zipball_url');
			expect((payload.assets as Array<Record<string, unknown>>)[0]).not.toHaveProperty('browser_download_url');
		});

		it('accepts string-coercible numeric id', async () => {
			mockClient.getRelease.mockResolvedValueOnce({ id: 7 } as never);
			await callTool('get_release', { owner: 'foo', repo: 'bar', id: '7' });
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
		it('returns decoded text content for a small text file', async () => {
			// rawRequest returns the Forgejo contents envelope (JSON), not the
			// pre-decoded string the SDK wrapper returned. Our tool now inspects
			// size/encoding and decodes base64 itself.
			const textContent = '# Test Repo\n\nA README.';
			mockClient.rawRequest.mockResolvedValueOnce({
				content: Buffer.from(textContent, 'utf8').toString('base64'),
				encoding: 'base64',
				size: textContent.length,
				name: 'README.md',
				path: 'README.md',
				sha: 's'.repeat(40),
				html_url: 'http://x',
			});

			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'README.md', ref: 'main',
			});

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/contents\/README\.md\?ref=main/),
			);
			const payload = extractContent(resp) as Record<string, unknown>;
			expect(payload.is_binary).toBe(false);
			expect(payload.content).toBe(textContent);
			expect(payload.encoding).toBe('utf8');
			expect(payload.size).toBe(textContent.length);
		});

		it('passes through file paths containing slashes', async () => {
			const text = 'src code';
			mockClient.rawRequest.mockResolvedValueOnce({
				content: Buffer.from(text, 'utf8').toString('base64'),
				encoding: 'base64',
				size: text.length,
				name: 'index.ts',
				path: 'src/index.ts',
			});
			await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'src/index.ts', ref: 'main',
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/contents\/src%2Findex\.ts\?ref=main/),
			);
		});

		it('accepts a commit SHA as ref', async () => {
			const text = 'content';
			mockClient.rawRequest.mockResolvedValueOnce({
				content: Buffer.from(text, 'utf8').toString('base64'),
				encoding: 'base64',
				size: text.length,
				name: 'file.txt',
				path: 'file.txt',
			});
			await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'file.txt', ref: '0'.repeat(40),
			});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/ref=0{40}/),
			);
		});

		it('returns binary envelope for files over max_bytes', async () => {
			// Pretend the file is 2 MB; default max_bytes is 512 KB.
			const hugeContent = Buffer.alloc(2 * 1024 * 1024, 65).toString('base64');
			mockClient.rawRequest.mockResolvedValueOnce({
				content: hugeContent,
				encoding: 'base64',
				size: 2 * 1024 * 1024,
				name: 'big.bin',
				path: 'big.bin',
			});
			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'big.bin', ref: 'main',
			});
			const payload = extractContent(resp) as Record<string, unknown>;
			expect(payload.is_binary).toBe(true);
			expect(payload.truncated).toBe(true);
			expect(payload.content).toBeUndefined();
			expect(payload.warning).toMatch(/exceeds max_bytes/);
		});

		it('returns binary envelope when decoded content has NUL bytes', async () => {
			// NUL byte in first 8 KB → looksBinary returns true.
			const binary = Buffer.from('hello\u0000world', 'utf8').toString('base64');
			mockClient.rawRequest.mockResolvedValueOnce({
				content: binary,
				encoding: 'base64',
				size: 11,
				name: 'data.bin',
				path: 'data.bin',
			});
			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'data.bin', ref: 'main',
			});
			const payload = extractContent(resp) as Record<string, unknown>;
			expect(payload.is_binary).toBe(true);
			expect(payload.warning).toMatch(/binary/i);
			expect(payload.content).toBeUndefined();
		});

		it('requires ref argument', async () => {
			const resp = await callTool('get_file_contents', { owner: 'foo', repo: 'bar', path: 'README.md' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/ref/i);
		});

		it('wraps 404 errors as isError: true', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(
				new ForgejoApiError(404, 'Not Found', 'file not found'),
			);
			const resp = await callTool('get_file_contents', {
				owner: 'foo', repo: 'bar', path: 'nope.md', ref: 'main',
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
			// Structured second content block should include http_status.
			const structured = JSON.parse(result.content[1].text);
			expect(structured.http_status).toBe(404);
		});
	});

	describe('list_tags', () => {
		it('calls rawRequest with paged tags path and returns Tag[]', async () => {
			const mockTags = [
				{ name: 'v1.0', id: 'abc', message: 'release 1.0', commit: { sha: 'def', url: '' } },
				{ name: 'v0.9', id: 'xyz', message: 'release 0.9', commit: { sha: '123', url: '' } },
			];
			mockClient.rawRequest.mockResolvedValueOnce(mockTags);

			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/tags\?page=1&limit=30/),
			);
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual(mockTags);
		});

		it('returns empty items array when repo has no tags', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
			const payload = extractContent(resp) as { items: unknown[] };
			expect(payload.items).toEqual([]);
		});

		it('uses default owner/repo from config', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_tags', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/default-owner\/default-repo\/tags/),
			);
		});

		it('wraps API errors as isError: true', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(new ForgejoApiError(403, 'Forbidden', 'denied'));
			const resp = await callTool('list_tags', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 403');
		});
	});
});
