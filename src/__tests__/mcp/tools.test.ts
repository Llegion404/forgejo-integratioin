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
	getCommitStatuses: jest.fn(),
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
		expect(resp.result).toMatchObject({
			protocolVersion: '2025-06-18',
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: 'forgejo-mcp', version: '0.1.0' },
		});
		// `instructions` is a free-form high-level guidance string; just
		// assert it's a non-empty string the agent can read.
		const result = resp.result as { instructions?: string };
		expect(typeof result.instructions).toBe('string');
		expect((result.instructions ?? '').length).toBeGreaterThan(0);
	});

	it('initialize echoes back a supported client protocolVersion', async () => {
		// Client offers an older supported version → server should accept it.
		const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
		buildMcpServer(fakeTransport, () => mockClient, () => config);
		const resp = (await fakeTransport.onMessage!({
			jsonrpc: '2.0',
			id: 99,
			method: 'initialize',
			params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
		} as JsonRpcRequest)) as JsonRpcResponse;
		expect((resp.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
	});

	it('initialize falls back to newest version when client version is unknown', async () => {
		const fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> } = {};
		buildMcpServer(fakeTransport, () => mockClient, () => config);
		const resp = (await fakeTransport.onMessage!({
			jsonrpc: '2.0',
			id: 99,
			method: 'initialize',
			params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
		} as JsonRpcRequest)) as JsonRpcResponse;
		expect((resp.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
	});

	it('tools/list returns all 40 tools', async () => {
		const tools = await listTools();
		expect(tools.length).toBe(40);
		const names = tools.map((t) => t.name);
		// Meta
		expect(names).toContain('list_instances');
		expect(names).toContain('get_current_user');
		// Search & discovery
		expect(names).toContain('search_repositories');
		expect(names).toContain('search_issues');
		expect(names).toContain('search_code');
		expect(names).toContain('search_users');
		// Issues
		expect(names).toContain('list_issues');
		expect(names).toContain('get_issue');
		expect(names).toContain('list_issue_comments');
		expect(names).toContain('get_issue_timeline');
		expect(names).toContain('list_repo_labels');
		// Pull requests
		expect(names).toContain('list_pull_requests');
		expect(names).toContain('get_pull_request');
		expect(names).toContain('list_pull_request_files');
		expect(names).toContain('list_pull_request_commits');
		expect(names).toContain('get_pull_request_refs');
		expect(names).toContain('list_pull_request_reviews');
		expect(names).toContain('list_review_comments');
		// CI status
		expect(names).toContain('get_pr_ci_status');
		expect(names).toContain('get_commit_statuses');
		// Reactions
		expect(names).toContain('list_comment_reactions');
		expect(names).toContain('list_issue_reactions');
		// Branch protection
		expect(names).toContain('list_branch_protections');
		expect(names).toContain('get_branch_protection');
		// Misc
		expect(names).toContain('list_releases');
		expect(names).toContain('get_release');
		expect(names).toContain('get_file_contents');
		expect(names).toContain('list_tags');
		// Attachments
		expect(names).toContain('list_issue_attachments');
		expect(names).toContain('get_attachment');
		// Workflows (v2)
		expect(names).toContain('list_workflows');
		expect(names).toContain('list_workflow_runs');
		expect(names).toContain('get_workflow_run');
		expect(names).toContain('get_workflow_jobs');
		expect(names).toContain('get_workflow_logs');
		expect(names).toContain('list_workflow_artifacts');
		// Repo navigation (v2)
		expect(names).toContain('list_repo_branches');
		expect(names).toContain('get_branch');
		expect(names).toContain('list_repo_commits');
		expect(names).toContain('compare_commits');
		// The standalone `get_pull_request_summary` tool has been folded into
		// `get_pull_request` (default compact path). Verifying it's gone:
		expect(names).not.toContain('get_pull_request_summary');
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

describe('MCP argument type validation', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('rejects boolean arg passed as string (full:"true")', async () => {
		// Previously the schema skipped boolean validation, so `full: "true"`
		// passed validation, then readBool("true", false) silently returned
		// false — the agent thought it asked for full payload, got compact.
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', full: 'true' });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		const text = (resp.result as { content: { text: string }[] }).content[0].text;
		expect(text).toMatch(/'full' must be a boolean/);
	});

	it('rejects boolean arg passed as number (full:1)', async () => {
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', full: 1 });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/'full' must be a boolean/);
	});

	it('rejects boolean arg passed as null', async () => {
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', full: null });
		// null is treated as missing required → for optional just falls through; but
		// the new validator explicitly rejects null on boolean properties.
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/'full' must be a boolean/);
	});

	it('rejects enum arg passed as non-string (state:42)', async () => {
		// Previously enum check was nested in the string branch and skipped
		// entirely for non-strings — letting `state: 42` hit the SDK as a
		// number. Now the enum check runs for any value type.
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', state: 42 });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		const text = (resp.result as { content: { text: string }[] }).content[0].text;
		expect(text).toMatch(/'state' must be one of/);
	});

	it('rejects enum arg passed as boolean (state:true)', async () => {
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', state: true });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/'state' must be one of/);
	});

	it('rejects enum arg passed as null', async () => {
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', state: null });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
	});

	it('rejects sections passed as a string (get_pull_request)', async () => {
		const resp = await callTool('get_pull_request', { owner: 'o', repo: 'r', number: 1, sections: 'reviews' });
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/'sections' must be an object/);
	});

	it('rejects unknown section keys (get_pull_request.sections.bogus)', async () => {
		const resp = await callTool('get_pull_request', {
			owner: 'o', repo: 'r', number: 1,
			sections: { bogus: true },
		});
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/sections\.bogus.*not allowed/);
	});

	it('rejects section value of wrong type (sections.reviews:"yes")', async () => {
		const resp = await callTool('get_pull_request', {
			owner: 'o', repo: 'r', number: 1,
			sections: { reviews: 'yes' },
		});
		expect((resp.result as { isError: boolean }).isError).toBe(true);
		expect((resp.result as { content: { text: string }[] }).content[0].text).toMatch(/sections\.reviews.*must be a boolean/);
	});

	it('accepts valid section toggles', async () => {
		mockClient.getPullRequest.mockResolvedValueOnce({
			number: 1, title: 't', state: 'open', draft: false, merged: false, mergeable: true,
			base: { ref: 'main' }, head: { ref: 'feature', sha: 'a'.repeat(40) },
			user: { login: 'alice' }, labels: [], created_at: '', updated_at: '',
		} as never);
		const resp = await callTool('get_pull_request', {
			owner: 'o', repo: 'r', number: 1,
			sections: { reviews: true, ci_status: false, description: true },
		});
		expect((resp.result as { isError: boolean }).isError ?? false).toBe(false);
	});

	it('accepts legitimate boolean args (full:true still works)', async () => {
		mockClient.listIssues.mockResolvedValueOnce([]);
		const resp = await callTool('list_issues', { owner: 'o', repo: 'r', full: true });
		expect((resp.result as { isError: boolean }).isError ?? false).toBe(false);
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
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_issues', { owner: 'foo', repo: 'bar', state: 'closed' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/issues\?state=closed&type=issues&page=1&limit=30/),
			);
		});

		it('falls back to default owner/repo from config', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_issues', {});
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/default-owner\/default-repo\/issues\?state=open&type=issues&page=1&limit=30/),
			);
		});

		it('defaults state to "open" when omitted', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/state=open/),
			);
		});

		it('rejects invalid state value', async () => {
			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar', state: 'invalid' });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
		});

		it('honours page + page_size args', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_issues', { owner: 'foo', repo: 'bar', page: 3, page_size: 50 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/page=3&limit=50$/),
			);
		});

		it('returns pagination envelope with has_more=true when page is full', async () => {
			// Return exactly page_size items → has_more should be true.
			const fullPage = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, title: 't', state: 'open' }));
			mockClient.rawRequest.mockResolvedValueOnce(fullPage);
			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload._meta.pagination).toEqual({
				page: 1, page_size: 30, returned: 30, has_more: true,
			});
		});

		it('returns pagination envelope with has_more=false on partial page', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([{ number: 1, title: 't', state: 'open' }]);
			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload._meta.pagination.has_more).toBe(false);
			expect(payload._meta.pagination.returned).toBe(1);
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

		it('returns degraded envelope with _meta.warnings when conversation fetch fails', async () => {
			// Primary getIssue succeeds, secondary comments pagedRequest rejects
			// (e.g. 403 on private repo). Previously this rejected the whole call.
			mockClient.getIssue.mockResolvedValueOnce({
				number: 42, title: 't', state: 'open', body: 'b', html_url: 'u',
				created_at: '', updated_at: '', user: { login: 'a' }, labels: [], assignees: [],
			} as never);
			mockClient.rawRequest.mockRejectedValueOnce(new Error('HTTP 403: forbidden'));

			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 42 });
			expect((resp.result as { isError: boolean }).isError ?? false).toBe(false);
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.number).toBe(42);
			expect(payload._meta.warnings).toEqual(
				expect.arrayContaining([expect.stringMatching(/Failed to fetch conversation.*403/)]),
			);
		});

		it('propagates primary getIssue failure as isError:true', async () => {
			mockClient.getIssue.mockRejectedValueOnce(new Error('HTTP 404: not found'));
			mockClient.rawRequest.mockResolvedValueOnce([] as never);

			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 999 });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/404/);
		});

		it('synthesizes empty conversation envelope when issue has zero comments', async () => {
			mockClient.getIssue.mockResolvedValueOnce({
				number: 7, title: 't', state: 'open', body: 'b', html_url: 'u',
				created_at: '', updated_at: '', user: { login: 'a' }, labels: [], assignees: [],
			} as never);
			mockClient.rawRequest.mockResolvedValueOnce([] as never);

			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 7 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.conversation).toEqual({ total: 0, returned: 0, truncated: false, items: [] });
		});
	});

	describe('list_issue_comments', () => {
		it('calls rawRequest with paged issue-comments path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 7 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/issues\/7\/comments\?page=1&limit=30/),
			);
		});
	});

	describe('get_issue_timeline', () => {
		it('calls rawRequest with paged timeline path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('get_issue_timeline', { owner: 'foo', repo: 'bar', number: 1 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/issues\/1\/timeline\?page=1&limit=30/),
			);
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
		it('calls rawRequest with state filter', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_pull_requests', { owner: 'foo', repo: 'bar', state: 'closed' });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\?state=closed&page=1&limit=30/),
			);
		});
	});

	describe('get_pull_request', () => {
		it('calls getPullRequest', async () => {
			mockClient.getPullRequest.mockResolvedValueOnce({} as never);
			await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 99 });
			expect(mockClient.getPullRequest).toHaveBeenCalledWith('foo', 'bar', 99);
		});

		it('returns degraded envelope with _meta.warnings when a section fails', async () => {
			// Primary getPullRequest succeeds; one of the section fetches rejects.
			mockClient.getPullRequest.mockResolvedValueOnce({
				number: 99, title: 't', state: 'open', draft: false, merged: false, mergeable: true,
				base: { ref: 'main' }, head: { ref: 'feature', sha: 'a'.repeat(40) },
				user: { login: 'a' }, labels: [], created_at: '', updated_at: '',
			} as never);
			// Section fetches are sequential pagedRequest calls: commits, conversation (rejects), files.
			mockClient.rawRequest
				.mockResolvedValueOnce([] as never)                                // commits
				.mockRejectedValueOnce(new Error('HTTP 403: forbidden'))           // conversation
				.mockResolvedValueOnce([] as never);                               // files

			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 99 });
			expect((resp.result as { isError: boolean }).isError ?? false).toBe(false);
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.number).toBe(99);
			expect(payload._meta.warnings).toEqual(
				expect.arrayContaining([expect.stringMatching(/conversation.*403/i)]),
			);
			// Other sections still populated despite the conversation failure.
			expect(payload.sections).toEqual(expect.arrayContaining(['description', 'commits', 'files_overview']));
		});

		it('handles PR with deleted head repo (head=null)', async () => {
			mockClient.getPullRequest.mockResolvedValueOnce({
				number: 99, title: 't', state: 'open', draft: false, merged: false, mergeable: false,
				base: { ref: 'main' }, head: null,
				user: { login: 'a' }, labels: [], created_at: '', updated_at: '',
			} as never);

			const resp = await callTool('get_pull_request', {
				owner: 'foo', repo: 'bar', number: 99,
				sections: { ci_status: true },
			});
			expect((resp.result as { isError: boolean }).isError ?? false).toBe(false);
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.ci_status.head_sha).toBe('');
			expect(payload.ci_status.summary).toBe('none');
			expect(payload.ci_status.warning).toMatch(/head.*unavailable|head.*deleted/i);
		});
	});

	describe('list_pull_request_files', () => {
		it('calls rawRequest with paged files path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_pull_request_files', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\/3\/files\?page=1&limit=30/),
			);
		});

		it('returns items unchanged when no patch options set (backward compat for per-file shape)', async () => {
			const files = [{ filename: 'a.ts', patch: '@@ -1,1 +1,1 @@\n+x' }];
			mockClient.rawRequest.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(files);
			expect(payload.items[0].patch).toBe('@@ -1,1 +1,1 @@\n+x');
			expect(payload.items[0]).not.toHaveProperty('patch_excluded');
			expect(payload._meta.pagination).toBeDefined();
		});

		it('strips patches and sets patch_excluded when include_patch=false', async () => {
			const files = [
				{ filename: 'a.ts', additions: 1, deletions: 0, changes: 1, patch: '@@ ...\n+x' },
				{ filename: 'b.ts', additions: 0, deletions: 1, changes: 1 },
			];
			mockClient.rawRequest.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', {
				owner: 'foo', repo: 'bar', number: 3, include_patch: false,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items[0].patch_excluded).toBe(true);
			expect(payload.items[0]).not.toHaveProperty('patch');
			expect(payload.items[0].filename).toBe('a.ts');
			expect(payload.items[1].patch_excluded).toBe(true);
		});

		it('truncates patches and sets patch_truncated when max_patch_lines set', async () => {
			const longPatch = '@@ -1,1 +1,1 @@\n' + Array.from({ length: 20 }, (_, i) => `+line${i}`).join('\n');
			const files = [{ filename: 'a.ts', additions: 20, deletions: 0, changes: 20, patch: longPatch }];
			mockClient.rawRequest.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', {
				owner: 'foo', repo: 'bar', number: 3, max_patch_lines: 3,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items[0].patch_truncated).toBe(true);
			expect(payload.items[0].patch).toContain('@@');
			expect(payload.items[0].patch).toContain('more lines)');
		});
	});

	describe('list_pull_request_commits', () => {
		it('calls rawRequest with paged commits path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\/3\/commits\?page=1&limit=30/),
			);
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
		it('calls rawRequest with paged reviews path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\/3\/reviews\?page=1&limit=30/),
			);
		});
	});

	describe('list_review_comments', () => {
		it('calls rawRequest with paged review-comments path', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([]);
			await callTool('list_review_comments', { owner: 'foo', repo: 'bar', number: 3, reviewId: 5 });
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\/3\/reviews\/5\/comments\?page=1&limit=30/),
			);
		});

		it('rejects when reviewId missing', async () => {
			const resp = await callTool('list_review_comments', { owner: 'foo', repo: 'bar', number: 3 });
			expect((resp.result as { isError: boolean }).isError).toBe(true);
			const text = (resp.result as { content: { text: string }[] }).content[0].text;
			expect(text).toMatch(/reviewId/);
		});
	});

	describe('get_pull_request (compact / fan-out)', () => {
		const mockPr = {
			number: 42, title: 'Fix bug', state: 'open', body: 'PR body text',
			user: { login: 'alice', avatar_url: 'http://x', full_name: 'Alice Wonder' },
			created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
			html_url: 'http://pr/42',
			head: { ref: 'feature', sha: 'a'.repeat(40), repo: { full_name: 'o/r' } },
			base: { ref: 'main' },
			mergeable: true, merged: false, merge_commit_sha: null,
			draft: false, comments: 2, labels: [{ name: 'bug', color: '#f00' }],
		};

		function setupDefaults() {
			mockClient.getPullRequest.mockResolvedValue(mockPr as never);
			// pagedRequest is called in deterministic order: commits, comments, files.
			// Each gets its own resolved value.
			mockClient.rawRequest.mockReset();
			mockClient.rawRequest
				.mockResolvedValueOnce([
					{ sha: 'b'.repeat(40), commit: { message: 'Commit 1', author: { name: 'u1', email: 'e1', date: '2025-01-01' } }, author: { login: 'u1' }, html_url: 'h' },
				] as never)
				.mockResolvedValueOnce([
					{ id: 1, body: 'Comment 1', user: { login: 'c1' }, created_at: '2025-01-01', html_url: 'h' },
				] as never)
				.mockResolvedValueOnce([
					{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1 +1 @@\n+x' },
				] as never);
		}

		it('returns default sections (description, commits, conversation, files_overview) and omits reviews/ci', async () => {
			setupDefaults();
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 42 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload.sections).toEqual(['description', 'commits', 'conversation', 'files_overview']);
			expect(payload.description.title).toBe('Fix bug');
			expect(payload.description.author).toEqual({ login: 'alice', full_name: 'Alice Wonder' });
			expect(payload.commits.total).toBe(1);
			expect(payload.commits.items[0].short_sha).toHaveLength(7);
			expect(payload.conversation.total).toBe(1);
			expect(payload.conversation.items[0].author).toEqual({ login: 'c1' });
			expect(payload.files_overview.total).toBe(1);
			expect(payload.files_overview.items[0].patch_excluded).toBe(true);
			expect(payload.reviews).toBeUndefined();
			expect(payload.ci_status).toBeUndefined();
			expect(payload._meta.truncated).toBe(false);
		});

		it('full=true short-circuits: returns raw SDK PR only, no fan-out', async () => {
			setupDefaults();
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 42, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload).toEqual(mockPr);
			// No fan-out — rawRequest should NOT have been called for section fetches.
			expect(mockClient.rawRequest).not.toHaveBeenCalled();
		});

		it('enables reviews and ci_status when sections opts request them', async () => {
			setupDefaults();
			// Add two more pagedRequest responses: reviews + commit statuses.
			mockClient.rawRequest
				.mockResolvedValueOnce([
					{ id: 1, state: 'APPROVE', body: 'LGTM', user: { login: 'r1' }, submitted_at: '2025-01-01', html_url: 'h' },
				] as never)
				.mockResolvedValueOnce([] as never); // commit statuses (empty)

			const resp = await callTool('get_pull_request', {
				owner: 'foo', repo: 'bar', number: 42,
				sections: { reviews: true, ci_status: true },
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload.sections).toContain('reviews');
			expect(payload.sections).toContain('ci_status');
			expect(payload.reviews.total).toBe(1);
			expect(payload.reviews.items[0].state).toBe('APPROVE');
			expect(payload.ci_status.summary).toBe('none');
			expect(payload.ci_status.head_sha).toBe('a'.repeat(40));
		});

		it('flags truncated when max_commits < array length', async () => {
			setupDefaults();
			// Override the first pagedRequest (commits) with 60 items.
			mockClient.rawRequest.mockReset();
			mockClient.rawRequest
				.mockResolvedValueOnce(
					Array.from({ length: 60 }, (_, i) => ({
						sha: 'b'.repeat(40), commit: { message: `Commit ${i}`, author: { name: 'u', email: 'e', date: '2025-01-01' } },
						author: { login: 'u' }, html_url: 'h',
					})) as never,
				)
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce([] as never);
			const resp = await callTool('get_pull_request', {
				owner: 'foo', repo: 'bar', number: 42, max_commits: 10,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.commits.total).toBe(60);
			expect(payload.commits.returned).toBe(10);
			expect(payload.commits.truncated).toBe(true);
			expect(payload._meta.truncated).toBe(true);
		});

		it('respects sections.description=false to omit description', async () => {
			setupDefaults();
			const resp = await callTool('get_pull_request', {
				owner: 'foo', repo: 'bar', number: 42,
				sections: { description: false, commits: false, conversation: false, files_overview: false },
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.sections).toEqual([]);
			expect(payload.description).toBeUndefined();
			expect(payload.commits).toBeUndefined();
			expect(payload.conversation).toBeUndefined();
			expect(payload.files_overview).toBeUndefined();
		});

		it('includes bounded patch in files_overview when max_patch_lines > 0', async () => {
			setupDefaults();
			const longPatch = '@@ -1 +1 @@\n' + Array.from({ length: 20 }, (_, i) => `+line${i}`).join('\n');
			mockClient.rawRequest.mockReset();
			mockClient.rawRequest
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce([] as never)
				.mockResolvedValueOnce([
					{ filename: 'a.ts', status: 'modified', additions: 20, deletions: 0, changes: 20, patch: longPatch },
				] as never);
			const resp = await callTool('get_pull_request', {
				owner: 'foo', repo: 'bar', number: 42, max_patch_lines: 3,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.files_overview.items[0].patch.truncated).toBe(true);
			expect(payload.files_overview.items[0].patch.text).toContain('@@');
		});

		it('requires number argument', async () => {
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar' });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/'number'/);
		});

		it('wraps PR fetch errors as isError: true', async () => {
			mockClient.getPullRequest.mockReset();
			mockClient.getPullRequest.mockRejectedValueOnce(new Error('HTTP 404: not found'));
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 999 });
			const result = resp.result as { isError: boolean; content: { text: string }[] };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
		});
	});

	describe('list_pull_requests (compact)', () => {
		it('default returns compact PR list items with bounded body + compact author', async () => {
			const longBody = 'z'.repeat(4000);
			mockClient.rawRequest.mockResolvedValueOnce([
				{
					number: 7, title: 'PR 7', state: 'open', body: longBody,
					user: { login: 'alice', avatar_url: 'u', full_name: 'Alice' },
					created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
					html_url: 'http://pr/7', head: { ref: 'feat', sha: 's'.repeat(40), repo: { full_name: 'o/r' } },
					base: { ref: 'main' }, mergeable: true, merged: false, merge_commit_sha: null,
					draft: false, comments: 4, labels: [{ name: 'bug', color: '#f00' }],
				},
			] as never);

			const resp = await callTool('list_pull_requests', { owner: 'foo', repo: 'bar' });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].number).toBe(7);
			expect(payload.items[0].author).toEqual({ login: 'alice', full_name: 'Alice' });
			expect(payload.items[0].labels).toEqual([{ name: 'bug' }]);
			expect(payload.items[0].body.truncated).toBe(true);
			expect(payload.items[0].body.original_length).toBe(4000);
			expect(payload.items[0].head_ref).toBe('feat');
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/pulls\?state=open&page=1&limit=30/),
			);
		});

		it('full=true returns raw SDK payload wrapped in items envelope', async () => {
			const rawItems = [{
				number: 7, title: 'PR 7', state: 'open', body: 'x',
				user: { login: 'alice', avatar_url: 'http://a' },
				created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
				html_url: 'http://pr/7', head: { ref: 'feat', sha: 's'.repeat(40), repo: { full_name: 'o/r' } },
				base: { ref: 'main' }, mergeable: true, merged: false, merge_commit_sha: null,
				draft: false, comments: 4, labels: [{ name: 'bug', color: '#f00' }],
			}];
			mockClient.rawRequest.mockResolvedValueOnce(rawItems as never);

			const resp = await callTool('list_pull_requests', { owner: 'foo', repo: 'bar', full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(rawItems);
			expect(payload._meta.pagination).toBeDefined();
		});
	});

	describe('list_issues (compact)', () => {
		it('default returns compact issue list items: bounded body, compact author, labels names only', async () => {
			const longBody = 'q'.repeat(3500);
			mockClient.rawRequest.mockResolvedValueOnce([
				{
					number: 12, title: 'Issue 12', state: 'open', body: longBody, html_url: 'http://i/12',
					created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z', comments: 2,
					user: { login: 'bob', avatar_url: 'http://b', full_name: 'Bob Smith' },
					labels: [{ name: 'bug', color: '#f00' }, { name: 'urgent', color: '#0f0' }],
				},
			] as never);

			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].number).toBe(12);
			expect(payload.items[0].author).toEqual({ login: 'bob', full_name: 'Bob Smith' });
			expect(payload.items[0].labels).toEqual([{ name: 'bug' }, { name: 'urgent' }]);
			expect(payload.items[0].body.truncated).toBe(true);
		});

		it('full=true returns raw SDK payload wrapped in items envelope', async () => {
			const rawItems = [{
				number: 12, title: 'I', state: 'open', body: 'b', html_url: 'u',
				created_at: 'c', updated_at: 'u2', comments: 0,
				user: { login: 'bob', avatar_url: 'http://b' },
				labels: [{ name: 'bug', color: '#f00' }],
			}];
			mockClient.rawRequest.mockResolvedValueOnce(rawItems as never);

			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar', full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(rawItems);
		});
	});

	describe('get_issue (compact / fan-out)', () => {
		const mockIssue = {
			id: 1,
			number: 790, title: 'Удалить информацию', state: 'open',
			body: 'Task description',
			html_url: 'http://i/790', comments: 2,
			created_at: '2026-07-13T16:07:39+05:00', updated_at: '2026-07-14T13:17:11+05:00',
			closed_at: null, due_date: '2026-07-14T23:59:59+05:00',
			is_locked: false,
			user: { login: 'Yeldashev_T', avatar_url: 'http://a', full_name: 'Елдашев Тахир' },
			assignees: [{ login: 'Ai40404', avatar_url: 'http://a2', full_name: 'Хмелевцев Александр' }],
			labels: [
				{ name: 'IN PROGRESS', color: 'fbca04' }, { name: 'off-roadmap', color: 'e11d21' },
			],
			milestone: null,
			assets: [{ id: 1, name: 'screenshot.png', size: 4096, uuid: 'abc-123', download_count: 0 }],
		};

		beforeEach(() => {
			mockClient.getIssue.mockResolvedValue(mockIssue as never);
			mockClient.rawRequest.mockResolvedValue([
				{ id: 1, body: 'Comment 1', user: { login: 'c1' }, created_at: '2025-01-01', html_url: 'h' },
				{ id: 2, body: 'Comment 2', user: { login: 'c2' }, created_at: '2025-01-02', html_url: 'h' },
			] as never);
		});

		afterEach(() => {
			mockClient.rawRequest.mockReset();
		});

		it('default fan-outs issue + comments in parallel and returns compact envelope', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(mockClient.getIssue).toHaveBeenCalledWith('foo', 'bar', 790);
			expect(mockClient.rawRequest).toHaveBeenCalledWith(
				'GET',
				expect.stringMatching(/\/repos\/foo\/bar\/issues\/790\/comments\?page=1&limit=50/),
			);

			expect(payload.number).toBe(790);
			expect(payload.title).toBe('Удалить информацию');
			expect(payload.html_url).toBe('http://i/790');
			expect(payload.due_at).toBe('2026-07-14T23:59:59+05:00');
			expect(payload.closed_at).toBeNull();
			expect(payload.author).toEqual({ login: 'Yeldashev_T', full_name: 'Елдашев Тахир' });
			expect(payload.assignees).toEqual([{ login: 'Ai40404', full_name: 'Хмелевцев Александр' }]);
			expect(payload.labels).toEqual([{ name: 'IN PROGRESS' }, { name: 'off-roadmap' }]);
			expect(payload.is_locked).toBe(false);
			expect(payload.comments_count).toBe(2);
			expect(payload.milestone).toBeNull();
			expect(payload.attachments).toEqual([{ name: 'screenshot.png', size: 4096, id: 1, uuid: 'abc-123', download_count: 0 }]);
			expect(payload.conversation.total).toBe(2);
			expect(payload.conversation.items[0].author).toEqual({ login: 'c1' });
			expect(payload._meta.truncated).toBe(false);
			expect(payload._meta.caps).toEqual({ max_body_length: 2000, max_comments: 50 });
			expect(payload._meta.hint).toMatch(/full=true/);
		});

		it('include_conversation=false skips the comments round trip', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790, include_conversation: false });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(mockClient.rawRequest).not.toHaveBeenCalled();
			expect(payload.conversation).toBeUndefined();
			expect(payload.number).toBe(790);
		});

		it('full=true returns raw SDK Issue object with no fan-out', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload).toEqual(mockIssue);
			expect(mockClient.rawRequest).not.toHaveBeenCalled();
		});

		it('flags truncated when conversation list exceeds max_comments', async () => {
			mockClient.rawRequest.mockResolvedValue(
				Array.from({ length: 60 }, (_, i) => ({
					id: i, body: `C${i}`, user: { login: `u${i}` }, created_at: '2025-01-01', html_url: 'h',
				})) as never,
			);
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790, max_comments: 10 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.conversation.total).toBe(60);
			expect(payload.conversation.returned).toBe(10);
			expect(payload.conversation.truncated).toBe(true);
			expect(payload._meta.truncated).toBe(true);
		});
	});

	describe('list_issue_comments (compact)', () => {
		it('default returns compact comment items with bounded bodies', async () => {
			const longBody = 'y'.repeat(5000);
			mockClient.rawRequest.mockResolvedValueOnce([
				{ id: 1, body: longBody, user: { login: 'a', full_name: 'A A' }, created_at: '2025-01-01', html_url: 'h' },
			] as never);
			const resp = await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 5 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].author).toEqual({ login: 'a', full_name: 'A A' });
			expect(payload.items[0].body.truncated).toBe(true);
			expect(payload.items[0].body.original_length).toBe(5000);
		});

		it('full=true returns raw SDK payload wrapped in items envelope', async () => {
			const raw = [{ id: 1, body: 'c', user: { login: 'a', avatar_url: 'u' }, created_at: '2025-01-01', html_url: 'h' }];
			mockClient.rawRequest.mockResolvedValueOnce(raw as never);
			const resp = await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 5, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(raw);
		});
	});

	describe('list_pull_request_commits (compact)', () => {
		it('default returns CommitsSummary with short SHAs + subjects', async () => {
			mockClient.rawRequest.mockResolvedValueOnce([
				{ sha: 'b'.repeat(40), commit: { message: 'first\n\nbody', author: { name: 'u', email: 'e', date: '2025-01-01' } }, author: { login: 'u' }, html_url: 'h' },
			] as never);
			const resp = await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].short_sha).toBe('b'.repeat(7));
			expect(payload.items[0].subject).toBe('first');
		});

		it('full=true returns raw SDK payload wrapped in items envelope', async () => {
			const raw = [{ sha: 'b'.repeat(40), commit: { message: 'first', author: { name: 'u', email: 'e', date: '2025-01-01' } }, author: { login: 'u' }, html_url: 'h' }];
			mockClient.rawRequest.mockResolvedValueOnce(raw as never);
			const resp = await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(raw);
		});
	});

	describe('list_pull_request_reviews (compact)', () => {
		it('default returns compact review items with bounded body', async () => {
			const longBody = 'x'.repeat(3000);
			mockClient.rawRequest.mockResolvedValueOnce([
				{ id: 1, state: 'APPROVE', body: longBody, user: { login: 'r', full_name: 'R R' }, submitted_at: '2025-01-01', html_url: 'h' },
			] as never);
			const resp = await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toHaveLength(1);
			expect(payload.items[0].author).toEqual({ login: 'r', full_name: 'R R' });
			expect(payload.items[0].body.truncated).toBe(true);
		});

		it('full=true returns raw SDK payload wrapped in items envelope', async () => {
			const raw = [{ id: 1, state: 'APPROVE', body: 'LGTM', user: { login: 'r', avatar_url: 'u' }, submitted_at: '2025-01-01', html_url: 'h' }];
			mockClient.rawRequest.mockResolvedValueOnce(raw as never);
			const resp = await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.items).toEqual(raw);
		});
	});
});
