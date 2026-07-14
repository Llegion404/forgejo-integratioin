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

		it('returns raw array unchanged when no patch options set (backward compat)', async () => {
			const files = [{ filename: 'a.ts', patch: '@@ -1,1 +1,1 @@\n+x' }];
			mockClient.getPullRequestFiles.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(files);
			expect(payload[0].patch).toBe('@@ -1,1 +1,1 @@\n+x');
			expect(payload[0]).not.toHaveProperty('patch_excluded');
		});

		it('strips patches and sets patch_excluded when include_patch=false', async () => {
			const files = [
				{ filename: 'a.ts', additions: 1, deletions: 0, changes: 1, patch: '@@ ...\n+x' },
				{ filename: 'b.ts', additions: 0, deletions: 1, changes: 1 },
			];
			mockClient.getPullRequestFiles.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', {
				owner: 'foo', repo: 'bar', number: 3, include_patch: false,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload[0].patch_excluded).toBe(true);
			expect(payload[0]).not.toHaveProperty('patch');
			expect(payload[0].filename).toBe('a.ts');
			// File with no patch also gets patch_excluded.
			expect(payload[1].patch_excluded).toBe(true);
		});

		it('truncates patches and sets patch_truncated when max_patch_lines set', async () => {
			const longPatch = '@@ -1,1 +1,1 @@\n' + Array.from({ length: 20 }, (_, i) => `+line${i}`).join('\n');
			const files = [{ filename: 'a.ts', additions: 20, deletions: 0, changes: 20, patch: longPatch }];
			mockClient.getPullRequestFiles.mockResolvedValueOnce(files as never);
			const resp = await callTool('list_pull_request_files', {
				owner: 'foo', repo: 'bar', number: 3, max_patch_lines: 3,
			});
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload[0].patch_truncated).toBe(true);
			expect(payload[0].patch).toContain('@@');
			expect(payload[0].patch).toContain('more lines)');
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
			mockClient.getPullRequestCommits.mockResolvedValue([
				{ sha: 'b'.repeat(40), commit: { message: 'Commit 1', author: { name: 'u1', email: 'e1', date: '2025-01-01' } }, author: { login: 'u1' }, html_url: 'h' },
			] as never);
			mockClient.getIssueComments.mockResolvedValue([
				{ id: 1, body: 'Comment 1', user: { login: 'c1' }, created_at: '2025-01-01', html_url: 'h' },
			] as never);
			mockClient.getPullRequestFiles.mockResolvedValue([
				{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1 +1 @@\n+x' },
			] as never);
		}

		it('returns default sections (description, commits, conversation, files_overview) and omits reviews/ci', async () => {
			setupDefaults();
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 42 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload.sections).toEqual(['description', 'commits', 'conversation', 'files_overview']);
			expect(payload.description.title).toBe('Fix bug');
			// full_name is kept when present (helpful for agents drafting replies).
			expect(payload.description.author).toEqual({ login: 'alice', full_name: 'Alice Wonder' });
			expect(payload.commits.total).toBe(1);
			expect(payload.commits.items[0].short_sha).toHaveLength(7);
			expect(payload.conversation.total).toBe(1);
			expect(payload.conversation.items[0].author).toEqual({ login: 'c1' });
			expect(payload.files_overview.total).toBe(1);
			// Patches dropped by default.
			expect(payload.files_overview.items[0].patch_excluded).toBe(true);
			expect(payload.reviews).toBeUndefined();
			expect(payload.ci_status).toBeUndefined();
			expect(payload._meta.truncated).toBe(false);
		});

		it('full=true short-circuits: returns raw SDK PR only, no fan-out', async () => {
			setupDefaults();
			const resp = await callTool('get_pull_request', { owner: 'foo', repo: 'bar', number: 42, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			// Raw PR object: same shape that mockClient.getPullRequest returned.
			expect(payload).toEqual(mockPr);
			// No fan-out — the optional methods should NOT have been called.
			expect(mockClient.getPullRequestCommits).not.toHaveBeenCalled();
			expect(mockClient.getIssueComments).not.toHaveBeenCalled();
			expect(mockClient.getPullRequestFiles).not.toHaveBeenCalled();
		});

		it('enables reviews and ci_status when sections opts request them', async () => {
			setupDefaults();
			mockClient.getPullRequestReviews.mockResolvedValue([
				{ id: 1, state: 'APPROVE', body: 'LGTM', user: { login: 'r1' }, submitted_at: '2025-01-01', html_url: 'h' },
			] as never);
			mockClient.getCommitStatuses.mockResolvedValue([] as never);

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
			expect(mockClient.getCommitStatuses).toHaveBeenCalledWith('foo', 'bar', 'a'.repeat(40));
		});

		it('flags truncated when max_commits < array length', async () => {
			setupDefaults();
			mockClient.getPullRequestCommits.mockResolvedValue(
				Array.from({ length: 60 }, (_, i) => ({
					sha: 'b'.repeat(40), commit: { message: `Commit ${i}`, author: { name: 'u', email: 'e', date: '2025-01-01' } },
					author: { login: 'u' }, html_url: 'h',
				})) as never,
			);
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
			mockClient.getPullRequestFiles.mockResolvedValue([
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
			mockClient.listPullRequests.mockResolvedValueOnce([
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
			expect(payload).toHaveLength(1);
			expect(payload[0].number).toBe(7);
			expect(payload[0].author).toEqual({ login: 'alice', full_name: 'Alice' });
			expect(payload[0].labels).toEqual([{ name: 'bug' }]);
			expect(payload[0].body.truncated).toBe(true);
			expect(payload[0].body.original_length).toBe(4000);
			expect(payload[0].head_ref).toBe('feat');
			expect(mockClient.listPullRequests).toHaveBeenCalledWith('foo', 'bar', 'open');
		});

		it('full=true returns raw SDK payload unchanged', async () => {
			const rawItems = [{
				number: 7, title: 'PR 7', state: 'open', body: 'x',
				user: { login: 'alice', avatar_url: 'http://a' },
				created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
				html_url: 'http://pr/7', head: { ref: 'feat', sha: 's'.repeat(40), repo: { full_name: 'o/r' } },
				base: { ref: 'main' }, mergeable: true, merged: false, merge_commit_sha: null,
				draft: false, comments: 4, labels: [{ name: 'bug', color: '#f00' }],
			}];
			mockClient.listPullRequests.mockResolvedValueOnce(rawItems as never);

			const resp = await callTool('list_pull_requests', { owner: 'foo', repo: 'bar', full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(rawItems);
		});
	});

	describe('list_issues (compact)', () => {
		it('default returns compact issue list items: bounded body, compact author, labels names only', async () => {
			const longBody = 'q'.repeat(3500);
			mockClient.listIssues.mockResolvedValueOnce([
				{
					number: 12, title: 'Issue 12', state: 'open', body: longBody, html_url: 'http://i/12',
					created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z', comments: 2,
					user: { login: 'bob', avatar_url: 'http://b', full_name: 'Bob Smith' },
					labels: [{ name: 'bug', color: '#f00' }, { name: 'urgent', color: '#0f0' }],
				},
			] as never);

			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar' });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toHaveLength(1);
			expect(payload[0].number).toBe(12);
			expect(payload[0].author).toEqual({ login: 'bob', full_name: 'Bob Smith' });
			expect(payload[0].labels).toEqual([{ name: 'bug' }, { name: 'urgent' }]);
			expect(payload[0].body.truncated).toBe(true);
			expect(mockClient.listIssues).toHaveBeenCalledWith('foo', 'bar', 'open');
		});

		it('full=true returns raw SDK payload unchanged', async () => {
			const rawItems = [{
				number: 12, title: 'I', state: 'open', body: 'b', html_url: 'u',
				created_at: 'c', updated_at: 'u2', comments: 0,
				user: { login: 'bob', avatar_url: 'http://b' },
				labels: [{ name: 'bug', color: '#f00' }],
			}];
			mockClient.listIssues.mockResolvedValueOnce(rawItems as never);

			const resp = await callTool('list_issues', { owner: 'foo', repo: 'bar', full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(rawItems);
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
			mockClient.getIssueComments.mockResolvedValue([
				{ id: 1, body: 'Comment 1', user: { login: 'c1' }, created_at: '2025-01-01', html_url: 'h' },
				{ id: 2, body: 'Comment 2', user: { login: 'c2' }, created_at: '2025-01-02', html_url: 'h' },
			] as never);
		});

		it('default fan-outs issue + comments in parallel and returns compact envelope', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(mockClient.getIssue).toHaveBeenCalledWith('foo', 'bar', 790);
			expect(mockClient.getIssueComments).toHaveBeenCalledWith('foo', 'bar', 790);

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
			// Conversation section
			expect(payload.conversation.total).toBe(2);
			expect(payload.conversation.items[0].author).toEqual({ login: 'c1' });
			expect(payload._meta.truncated).toBe(false);
			expect(payload._meta.caps).toEqual({ max_body_length: 2000, max_comments: 50 });
			expect(payload._meta.hint).toMatch(/full=true/);
		});

		it('include_conversation=false skips the getIssueComments round trip', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790, include_conversation: false });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(mockClient.getIssueComments).not.toHaveBeenCalled();
			expect(payload.conversation).toBeUndefined();
			// Other compact fields still present
			expect(payload.number).toBe(790);
		});

		it('full=true returns raw SDK Issue object with no fan-out', async () => {
			const resp = await callTool('get_issue', { owner: 'foo', repo: 'bar', number: 790, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);

			expect(payload).toEqual(mockIssue);
			expect(mockClient.getIssueComments).not.toHaveBeenCalled();
		});

		it('flags truncated when conversation list exceeds max_comments', async () => {
			mockClient.getIssueComments.mockResolvedValue(
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
		it('default returns ConversationSummary shape with bounded bodies', async () => {
			const longBody = 'y'.repeat(5000);
			mockClient.getIssueComments.mockResolvedValue([
				{ id: 1, body: longBody, user: { login: 'a', full_name: 'A A' }, created_at: '2025-01-01', html_url: 'h' },
			] as never);
			const resp = await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 5 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.total).toBe(1);
			expect(payload.items[0].author).toEqual({ login: 'a', full_name: 'A A' });
			expect(payload.items[0].body.truncated).toBe(true);
			expect(payload.items[0].body.original_length).toBe(5000);
		});

		it('full=true returns raw SDK payload', async () => {
			const raw = [{ id: 1, body: 'c', user: { login: 'a', avatar_url: 'u' }, created_at: '2025-01-01', html_url: 'h' }];
			mockClient.getIssueComments.mockResolvedValue(raw as never);
			const resp = await callTool('list_issue_comments', { owner: 'foo', repo: 'bar', number: 5, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(raw);
		});
	});

	describe('list_pull_request_commits (compact)', () => {
		it('default returns CommitsSummary with short SHAs + subjects', async () => {
			mockClient.getPullRequestCommits.mockResolvedValue([
				{ sha: 'b'.repeat(40), commit: { message: 'first\n\nbody', author: { name: 'u', email: 'e', date: '2025-01-01' } }, author: { login: 'u' }, html_url: 'h' },
			] as never);
			const resp = await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.total).toBe(1);
			expect(payload.items[0].short_sha).toBe('b'.repeat(7));
			expect(payload.items[0].subject).toBe('first');
		});

		it('full=true returns raw SDK payload', async () => {
			const raw = [{ sha: 'b'.repeat(40), commit: { message: 'first', author: { name: 'u', email: 'e', date: '2025-01-01' } }, author: { login: 'u' }, html_url: 'h' }];
			mockClient.getPullRequestCommits.mockResolvedValue(raw as never);
			const resp = await callTool('list_pull_request_commits', { owner: 'foo', repo: 'bar', number: 3, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(raw);
		});
	});

	describe('list_pull_request_reviews (compact)', () => {
		it('default returns compact review items with bounded body', async () => {
			const longBody = 'x'.repeat(3000);
			mockClient.getPullRequestReviews.mockResolvedValue([
				{ id: 1, state: 'APPROVE', body: longBody, user: { login: 'r', full_name: 'R R' }, submitted_at: '2025-01-01', html_url: 'h' },
			] as never);
			const resp = await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3 });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload.total).toBe(1);
			expect(payload.items[0].author).toEqual({ login: 'r', full_name: 'R R' });
			expect(payload.items[0].body.truncated).toBe(true);
		});

		it('full=true returns raw SDK payload', async () => {
			const raw = [{ id: 1, state: 'APPROVE', body: 'LGTM', user: { login: 'r', avatar_url: 'u' }, submitted_at: '2025-01-01', html_url: 'h' }];
			mockClient.getPullRequestReviews.mockResolvedValue(raw as never);
			const resp = await callTool('list_pull_request_reviews', { owner: 'foo', repo: 'bar', number: 3, full: true });
			const payload = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
			expect(payload).toEqual(raw);
		});
	});
});
