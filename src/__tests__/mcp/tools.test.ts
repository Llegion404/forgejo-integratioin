import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig, _snapshotEnvForTesting, _resetEnvForTesting, ENV_INSTANCE_URL } from '../../mcp/config';

import { McpForgejoClient } from '../../mcp/client';

import { enableFetchMocks } from 'jest-fetch-mock';

enableFetchMocks();

const config: McpInstanceConfig = {
	instanceUrl: 'https://git.example.com',
	token: 'test-tok',
	defaultOwner: 'default-owner',
	defaultRepo: 'default-repo',
};

/** Stand-in for the Forgejo SDK client used by the server under test. */
const mockClient: jest.Mocked<McpForgejoClient> = {
	listIssues: jest.fn(),
	getIssue: jest.fn(),
	getIssueComments: jest.fn(),
	getIssueTimeline: jest.fn(),
	listPullRequests: jest.fn(),
	getPullRequest: jest.fn(),
	getPullRequestFiles: jest.fn(),
	getPullRequestCommits: jest.fn(),
	getPullRequestRefs: jest.fn(),
	getPullRequestReviews: jest.fn(),
	getReviewComments: jest.fn(),
	rawRequest: jest.fn(),
	testConnection: jest.fn(),
} as unknown as jest.Mocked<McpForgejoClient>;

interface FakeTransport {
	onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined>;
}

/**
 * Drive the server. Returns the parsed JSON-RPC response (assumes exactly one).
 */
async function callTool(name: string, args: unknown): Promise<JsonRpcResponse> {
	let receivedHandler: ((m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined>) | undefined;
	const fakeTransport: { onMessage?: typeof receivedHandler } = {};
	buildMcpServer(fakeTransport, () => mockClient, () => config);
	const handler = fakeTransport.onMessage!;

	const result = await handler({
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args },
	} as JsonRpcRequest);
	return result as JsonRpcResponse;
}

async function listTools(): Promise<{ name: string }[]> {
	const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
	buildMcpServer(fakeTransport, () => mockClient, () => config);
	const resp = await fakeTransport.onMessage!({
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/list',
		params: {},
	} as JsonRpcRequest);
	const result = resp!.result as { tools: { name: string }[] };
	return result.tools;
}

async function callInitialize(): Promise<JsonRpcResponse> {
	const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
	buildMcpServer(fakeTransport, () => mockClient, () => config);
	return await fakeTransport.onMessage!({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
	} as JsonRpcRequest) as JsonRpcResponse;
}

describe('MCP server protocol', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('initialize responds with protocol version + tools capability', async () => {
		const resp = await callInitialize();
		expect(resp.result).toEqual({
			protocolVersion: '2025-06-18',
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'forgejo-mcp', version: '0.1.0' },
		});
	});

	it('tools/list returns all 27 tools', async () => {
		const tools = await listTools();
		expect(tools.length).toBe(27);
		const names = tools.map((t) => t.name);
		expect(names).toContain('list_instances');
		expect(names).toContain('get_current_user');
		expect(names).toContain('search_repositories');
		expect(names).toContain('list_issues');
		expect(names).toContain('get_issue');
		expect(names).toContain('list_issue_comments');
		expect(names).toContain('get_issue_timeline');
		expect(names).toContain('list_repo_labels');
		expect(names).toContain('list_pull_requests');
		expect(names).toContain('get_pull_request');
		expect(names).toContain('list_pull_request_files');
		expect(names).toContain('list_pull_request_commits');
		expect(names).toContain('get_pull_request_refs');
		expect(names).toContain('list_pull_request_reviews');
		expect(names).toContain('list_review_comments');
		expect(names).toContain('get_pr_ci_status');
		expect(names).toContain('get_commit_statuses');
		expect(names).toContain('list_comment_reactions');
		expect(names).toContain('list_issue_reactions');
		expect(names).toContain('list_branch_protections');
		expect(names).toContain('get_branch_protection');
		expect(names).toContain('list_releases');
		expect(names).toContain('get_release');
		expect(names).toContain('get_file_contents');
		expect(names).toContain('list_tags');
		expect(names).toContain('list_issue_attachments');
		expect(names).toContain('get_attachment');
	});

	it('returns METHOD_NOT_FOUND for unknown method', async () => {
		const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
		buildMcpServer(fakeTransport, () => mockClient, () => config);
		const resp = await fakeTransport.onMessage!({
			jsonrpc: '2.0',
			id: 1,
			method: 'totally_unknown',
			params: {},
		} as JsonRpcRequest) as JsonRpcResponse;
		expect(resp.error!.code).toBe(-32601);
	});

	it('returns METHOD_NOT_FOUND for unknown tool name', async () => {
		const resp = await callTool('no_such_tool', {});
		expect(resp.error!.code).toBe(-32601);
	});

	it('notifications/initialized produces no response', async () => {
		const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
		buildMcpServer(fakeTransport, () => mockClient, () => config);
		const resp = await fakeTransport.onMessage!({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		} as unknown as JsonRpcRequest);
		expect(resp).toBeUndefined();
	});
});

describe('MCP tool invocations', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('list_instances', () => {
		let envSnapshot: Record<string, string | undefined>;
		beforeEach(() => {
			envSnapshot = _snapshotEnvForTesting();
			_resetEnvForTesting({});
		});
		afterEach(() => {
			_resetEnvForTesting(envSnapshot);
		});

		it('returns active config with env-var source when FORGEJO_URL set', async () => {
			process.env.FORGEJO_URL = 'https://env.example.com';
			const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
			buildMcpServer(fakeTransport, () => mockClient, () => config);
			const resp = await fakeTransport.onMessage!({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'list_instances', arguments: {} },
			} as JsonRpcRequest) as JsonRpcResponse;
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.active.source).toBe('env-vars');
			expect(payload.active.instanceUrl).toBe(config.instanceUrl);
			expect(ENV_INSTANCE_URL).toBeDefined();
		});

		it('returns active config with instances.json source when no env var', async () => {
			const resp = await callTool('list_instances', {});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.active.instanceUrl).toBe(config.instanceUrl);
		});
	});

	describe('get_current_user', () => {
		it('calls GET /user via rawRequest', async () => {
			mockClient.rawRequest.mockResolvedValueOnce({ login: 'alice', id: 1 });
			const resp = await callTool('get_current_user', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/user');
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.login).toBe('alice');
		});

		it('returns isError:true when API call rejects', async () => {
			mockClient.rawRequest.mockRejectedValueOnce(new Error('401 Unauthorized'));
			const resp = await callTool('get_current_user', {});
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/Tool 'get_current_user' failed: 401 Unauthorized/);
			expect((resp.result as { isError: boolean }).isError).toBe(true);
		});
	});

	describe('search_repositories', () => {
		it('rejects empty query', async () => {
			const resp = await callTool('search_repositories', { query: '' });
			// Empty string caught by schema minLength validation
			expect((resp.result as { isError: boolean }).isError).toBe(true);
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/'query'/);
		});

		it('calls /repos/search with encoded query and limit', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('search_repositories', { query: 'forgejo ui', limit: 50 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				'/repos/search?q=forgejo%20ui&limit=50',
			);
		});

		it('uses default limit of 30 when not specified', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('search_repositories', { query: 'x' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/limit=30/),
			);
		});

		it('rejects unknown argument', async () => {
			const resp = await callTool('search_repositories', { query: 'x', bogus: true });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
		});
	});

	describe('list_issues', () => {
		it('calls listIssues with owner/repo from args', async () => {
			mockClient.listIssues.mockResolvedValueOnce([]);
			await callTool('list_issues', { owner: 'foo', repo: 'bar', state: 'closed' });
			expect(mockClient.listIssues).toHaveBeenCalledWith('foo', 'bar', 'closed');
		});

		it('falls back to default owner/repo from config', async () => {
			mockClient.listIssues.mockResolvedValueOnce([]);
			await callTool('list_issues', {});
			expect(mockClient.listIssues).toHaveBeenCalledWith('default-owner', 'default-repo', 'open');
		});

		it('defaults state to "open" when omitted', async () => {
			mockClient.listIssues.mockResolvedValueOnce([]);
			await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			expect(mockClient.listIssues).toHaveBeenCalledWith('foo', 'bar', 'open');
		});

		it('rejects invalid state value', async () => {
			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar', state: 'invalid' });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
		});
	});

	describe('get_issue', () => {
		it('calls getIssue with integer number', async () => {
			mockClient.getIssue.mockResolvedValueOnce({ number: 42 } as never);
			await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 42 });
			expect(mockClient.getIssue).toHaveBeenCalledWith('foo', 'bar', 42);
		});

		it('accepts numeric string for number', async () => {
			mockClient.getIssue.mockResolvedValueOnce({} as never);
			await callTool('get_issue', { owner: 'foo', repo: 'bar', number: '123' });
			expect(mockClient.getIssue).toHaveBeenCalledWith('foo', 'bar', 123);
		});

		it('rejects string number under 1', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: '0' });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
		});

		it('rejects non-numeric string', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 'abc' });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/must be an integer/);
		});
	});

	describe('list_issue_comments', () => {
		it('calls getIssueComments with owner/repo/number', async () => {
			mockClient.getIssueComments.mockResolvedValueOnce([]);
			await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 7 });
			expect(mockClient.getIssueComments).toHaveBeenCalledWith('foo', 'bar', 7);
		});
	});

	describe('get_issue_timeline', () => {
		it('calls getIssueTimeline', async () => {
			mockClient.getIssueTimeline.mockResolvedValueOnce([]);
			await callTool('get_issue_timeline', { owner: 'foo', repo: 'bar', number: 1 });
			expect(mockClient.getIssueTimeline).toHaveBeenCalledWith('foo', 'bar', 1);
		});
	});

	describe('list_repo_labels', () => {
		it('sends GET /repos/{owner}/{repo}/labels via rawRequest', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_labels', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo/bar/labels');
		});

		it('URL-encodes special characters in owner/repo', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_repo_labels', { owner: 'foo bar', repo: 'baz/qux' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith('GET', '/repos/foo%20bar/baz%2Fqux/labels');
		});
	});

	describe('list_pull_requests', () => {
		it('calls listPullRequests with state filter', async () => {
			mockClient.listPullRequests.mockResolvedValueOnce([]);
			await callTool('list_pull_requests', { owner: 'foo', repo: 'bar', state: 'closed' });
			expect(mockClient.listPullRequests).toHaveBeenCalledWith('foo', 'bar', 'closed');
		});
	});

	describe('get_pull_request', () => {
		it('calls getPullRequest', async () => {
			mockClient.getPullRequest.mockResolvedValueOnce({} as never);
			await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 99 });
			expect(mockClient.getPullRequest).toHaveBeenCalledWith('foo', 'bar', 99);
		});
	});

	describe('list_pull_request_files', () => {
		it('calls getPullRequestFiles', async () => {
			mockClient.getPullRequestFiles.mockResolvedValueOnce([]);
			await callTool('list_pull_request_files', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.getPullRequestFiles).toHaveBeenCalledWith('foo', 'bar', 3);
		});
	});

	describe('list_pull_request_commits', () => {
		it('calls getPullRequestCommits', async () => {
			mockClient.getPullRequestCommits.mockResolvedValueOnce([]);
			await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.getPullRequestCommits).toHaveBeenCalledWith('foo', 'bar', 3);
		});
	});

	describe('get_pull_request_refs', () => {
		it('calls getPullRequestRefs', async () => {
			mockClient.getPullRequestRefs.mockResolvedValueOnce({ base: 'main', head: 'feature' });
			await callTool('get_pull_request_refs', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.getPullRequestRefs).toHaveBeenCalledWith('foo', 'bar', 3);
		});
	});

	describe('list_pull_request_reviews', () => {
		it('calls getPullRequestReviews', async () => {
			mockClient.getPullRequestReviews.mockResolvedValueOnce([]);
			await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.getPullRequestReviews).toHaveBeenCalledWith('foo', 'bar', 3);
		});
	});

	describe('list_review_comments', () => {
		it('calls getReviewComments with both prNumber and reviewId', async () => {
			mockClient.getReviewComments.mockResolvedValueOnce([]);
			await callTool('list_review_comments', { owner: 'foo', repo: 'bar', number: 3, reviewId: 5 });
			expect(mockClient.getReviewComments).toHaveBeenCalledWith('foo', 'bar', 3, 5);
		});

		it('rejects when reviewId missing', async () => {
			const resp = await callTool('list_review_comments', { owner: 'foo', repo: 'bar', number: 3 });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/reviewId/);
		});
	});
});
