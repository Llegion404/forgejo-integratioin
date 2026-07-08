/**
 * Unit tests for image attachment tools.
 *
 * The `list_issue_attachments` tool uses the SDK's `rawRequest` (mocked here
 * as `mockClient.rawRequest`). The `get_attachment` tool bypasses the SDK
 * and calls `fetch` directly — so we mock `global.fetch` to return binary
 * bytes and verify the dispatcher emits a proper MCP ImageContent block.
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

interface MockResponse {
	ok: boolean;
	status: number;
	headers: { get: (k: string) => string | null };
	arrayBuffer: () => Promise<ArrayBuffer>;
}

function mockImageResponse(bytes: number[], mimeType: string, status = 200): MockResponse {
	const buf = Buffer.from(bytes);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			// Real Headers.get() returns null for missing headers, not ''
			get: (k) => (k.toLowerCase() === 'content-type' && mimeType ? mimeType : null),
		},
		arrayBuffer: () => Promise.resolve(ab),
	};
}

describe('MCP attachment tools', () => {
	let savedFetch: typeof global.fetch;
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

	beforeEach(() => {
		jest.clearAllMocks();
		savedFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = savedFetch;
	});

	describe('list_issue_attachments', () => {
		it('calls GET /repos/{o}/{r}/issues/{n}/assets via rawRequest', async () => {
			const mockAssets = [
				{
					id: 1, name: 'screenshot.png', size: 8192, download_count: 3,
					created_at: '2024-01-15T10:00:00Z',
					uuid: 'abc-123-def',
					browser_download_url: 'https://git.example.com/attachments/abc-123-def',
				},
			];
			(mockClient.rawRequest as jest.Mock).mockResolvedValue(mockAssets);

			const resp = await callTool('list_issue_attachments', { owner: 'foo', repo: 'bar', number: 5 });

			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/issues/5/assets',
			);
			const result = resp.result as { content: { text: string }[] };
			expect(JSON.parse(result.content[0].text)).toEqual(mockAssets);
		});

		it('uses default owner/repo from config', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_issue_attachments', { number: 1 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/default-owner/default-repo/issues/1/assets',
			);
		});

		it('requires number argument (handler-throws via resolveNumber)', async () => {
			const resp = await callTool('list_issue_attachments', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/number/i);
		});

		it('works for PR numbers (same endpoint — Forgejo uses issue numbers)', async () => {
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([]);
			await callTool('list_issue_attachments', { owner: 'foo', repo: 'bar', number: 42 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/foo/bar/issues/42/assets',
			);
		});

		it('wraps 404 errors as isError: true', async () => {
			(mockClient.rawRequest as jest.Mock).mockRejectedValue(
				new Error('HTTP 404: issue not found'),
			);
			const resp = await callTool('list_issue_attachments', {
				owner: 'foo', repo: 'bar', number: 999,
			});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});
	});

	describe('get_attachment', () => {
		it('fetches binary bytes via fetch and emits MCP ImageContent block', async () => {
			const pngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse(pngBytes, 'image/png'),
			) as unknown as typeof global.fetch;

			const resp = await callTool('get_attachment', { uuid: 'abc-123-def' });

			expect(global.fetch).toHaveBeenCalledWith(
				'https://git.example.com/attachments/abc-123-def',
				expect.objectContaining({ redirect: 'follow' }),
			);
			const result = resp.result as {
				content: { type: string; data?: string; mimeType?: string; text?: string }[];
			};
			expect(result.content[0].type).toBe('image');
			expect(result.content[0].data).toBe(Buffer.from(pngBytes).toString('base64'));
			expect(result.content[0].mimeType).toBe('image/png');
			// Critically: NOT JSON.stringify'd into text content
			expect(result.content[0].text).toBeUndefined();
		});

		it('passes auth header when token is in config', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([0x00], 'application/octet-stream', 200),
			) as unknown as typeof global.fetch;
			await callTool('get_attachment', { uuid: 'token-test' });
			expect((global.fetch as jest.Mock).mock.calls[0][1]).toEqual({
				headers: { Authorization: 'token test-tok' },
				redirect: 'follow',
			});
		});

		it('omits auth header when token is empty', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([0x00], 'application/octet-stream', 200),
			) as unknown as typeof global.fetch;
			const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
			buildMcpServer(
				fakeTransport,
				() => mockClient as unknown as McpForgejoClient,
				() => ({ ...config, token: '' }),
			);
			await fakeTransport.onMessage!({
				jsonrpc: '2.0', id: 1, method: 'tools/call',
				params: { name: 'get_attachment', arguments: { uuid: 'x' } },
			} as JsonRpcRequest);
			expect((global.fetch as jest.Mock).mock.calls[0][1]).toEqual({
				headers: {},
				redirect: 'follow',
			});
		});

		it('URL-encodes the uuid (handles slashes and special chars)', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([0x00], 'image/png', 200),
			) as unknown as typeof global.fetch;
			await callTool('get_attachment', { uuid: 'foo bar/with%special' });
			// encodeURIComponent encodes spaces as %20 and slashes as %2F
			expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
				'https://git.example.com/attachments/foo%20bar%2Fwith%25special',
			);
		});

		it('returns the MIME type from the response Content-Type header', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([0xFF, 0xD8, 0xFF], 'image/jpeg', 200),
			) as unknown as typeof global.fetch;
			const resp = await callTool('get_attachment', { uuid: 'jpg-uuid' });
			const result = resp.result as { content: { mimeType: string }[] };
			expect(result.content[0].mimeType).toBe('image/jpeg');
		});

		it('falls back to application/octet-stream when Content-Type missing', async () => {
			global.fetch = jest.fn().mockResolvedValue(mockImageResponse([0x00], '', 200)) as unknown as typeof global.fetch;
			const resp = await callTool('get_attachment', { uuid: 'no-mime' });
			const result = resp.result as { content: { mimeType: string }[] };
			expect(result.content[0].mimeType).toBe('application/octet-stream');
		});

		it('wraps HTTP 404 as isError: true', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([], 'text/plain', 404),
			) as unknown as typeof global.fetch;
			const resp = await callTool('get_attachment', { uuid: 'nonexistent' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/HTTP 404/);
		});

		it('wraps HTTP 500 errors as isError: true', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([], 'text/plain', 500),
			) as unknown as typeof global.fetch;
			const resp = await callTool('get_attachment', { uuid: 'broken' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
		});

		it('requires uuid argument', async () => {
			const resp = await callTool('get_attachment', {});
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/uuid/i);
		});

		it('strips trailing slash from instance URL', async () => {
			global.fetch = jest.fn().mockResolvedValue(
				mockImageResponse([0x00], 'image/png', 200),
			) as unknown as typeof global.fetch;
			const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
			buildMcpServer(
				fakeTransport,
				() => mockClient as unknown as McpForgejoClient,
				() => ({ ...config, instanceUrl: 'https://git.example.com/' }),
			);
			await fakeTransport.onMessage!({
				jsonrpc: '2.0', id: 1, method: 'tools/call',
				params: { name: 'get_attachment', arguments: { uuid: 'abc' } },
			} as JsonRpcRequest);
			expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
				'https://git.example.com/attachments/abc',
			);
		});
	});

	describe('dispatcher image content handling', () => {
		it('does not emit image content for non-image tool returns', async () => {
			// list_issue_attachments returns a JSON array — should be text content, not image.
			(mockClient.rawRequest as jest.Mock).mockResolvedValue([{ uuid: 'abc', name: 'x.png' }]);
			const resp = await callTool('list_issue_attachments', { number: 1 });
			const result = resp.result as { content: { type: string; text: string }[] };
			expect(result.content[0].type).toBe('text');
			expect(result.content[0].text).toContain('abc');
		});

		it('ImageToolResult marker object is the only trigger for image content', async () => {
			// Even when an object happens to have a `data` and `mimeType` field,
			// without the `__image: true` marker it should be JSON-stringified as text.
			(mockClient.rawRequest as jest.Mock).mockResolvedValue({
				data: 'looks-like-base64', mimeType: 'image/png',  // missing __image: true
			});
			const resp = await callTool('list_issue_attachments', { number: 1 });
			const result = resp.result as { content: { type: string; text: string }[] };
			expect(result.content[0].type).toBe('text');
			expect(JSON.parse(result.content[0].text)).toEqual({
				data: 'looks-like-base64', mimeType: 'image/png',
			});
		});
	});
});
