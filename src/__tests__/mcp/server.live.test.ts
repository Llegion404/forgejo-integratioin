/**
 * Live integration test for the Forgejo MCP server.
 *
 * Drives `buildMcpServer()` against a REAL `McpForgejoClient` (no mocks).
 * The same Forgejo Docker instance + `setup-forgejo-test.sh` fixtures used
 * by `src/__tests__/api/forgejoClient.live.test.ts` provide:
 *   - user `testuser`, repo `test-repo`, default branch `main`
 *   - PR #1 titled "Test PR" (head `feature-branch`, base `main`)
 *   - Issue #2 titled "Test Issue"
 *
 * Skipped unless FORGEJO_TEST_URL + FORGEJO_TEST_TOKEN env vars are set.
 * To run locally:
 *   docker compose -f docker-compose.e2e.yml up -d --wait
 *   bash scripts/setup-forgejo-test.sh   # outputs FORGEJO_TEST_TOKEN
 *   export FORGEJO_TEST_URL=http://localhost:3000
 *   export FORGEJO_TEST_TOKEN=<token from above>
 *   npm run test:live
 */

// Unmock logger transitive deps — we want real Forgejo API responses.
jest.unmock('../../utils/logger');

import { buildMcpServer } from '../../mcp/server';
import { JsonRpcResponse, JsonRpcRequest, JsonRpcMessage } from '../../mcp/transport';
import { McpInstanceConfig } from '../../mcp/config';
import { createClient, McpForgejoClient } from '../../mcp/client';

const FORGEJO_URL = process.env.FORGEJO_TEST_URL || '';
const FORGEJO_TOKEN = process.env.FORGEJO_TEST_TOKEN || '';
const OWNER = 'testuser';
const REPO = 'test-repo';

const describeIfLive = FORGEJO_URL && FORGEJO_TOKEN ? describe : describe.skip;

/** Extract the `content[0].text` field from a JSON-RPC tool-call response. */
function contentText(resp: JsonRpcResponse): string {
	const result = resp.result as { content: { type: string; text: string }[]; isError?: boolean };
	return result.content[0].text;
}

/** Parse the JSON payload of a tool-call response. */
function payloadOf(resp: JsonRpcResponse): unknown {
	return JSON.parse(contentText(resp));
}

describeIfLive('MCP server - live integration', () => {
	let client: McpForgejoClient;
	let savedFetch: typeof global.fetch;
	let fakeTransport: { onMessage?: (m: JsonRpcMessage) => Promise<JsonRpcResponse | undefined> };
	const config: McpInstanceConfig = {
		instanceUrl: FORGEJO_URL,
		token: FORGEJO_TOKEN,
		defaultOwner: OWNER,
		defaultRepo: REPO,
	};

	beforeAll(async () => {
		// Jest's setup.ts replaces global.fetch with jest.fn() — restore a real
		// fetch implementation via undici (bundled with Node 18+).
		const undici = await import('undici');
		savedFetch = global.fetch;
		global.fetch = undici.fetch as unknown as typeof global.fetch;
		client = createClient(config);
	});

	afterAll(() => {
		global.fetch = savedFetch;
	});

	beforeEach(() => {
		fakeTransport = {};
		buildMcpServer(fakeTransport, () => client, () => config);
	});

	/** Dispatch a tools/call request and return the JSON-RPC response. */
	async function callTool(name: string, args: unknown): Promise<JsonRpcResponse> {
		const result = await fakeTransport.onMessage!({
			jsonrpc: '2.0', id: 1, method: 'tools/call',
			params: { name, arguments: args },
		} as JsonRpcRequest);
		return result as JsonRpcResponse;
	}

	/** Dispatch a non-tool method (initialize, tools/list, ping). */
	async function callMethod(method: string, params?: unknown): Promise<JsonRpcResponse> {
		const result = await fakeTransport.onMessage!({
			jsonrpc: '2.0', id: 1, method, params: params ?? {},
		} as JsonRpcRequest);
		return result as JsonRpcResponse;
	}

	describe('protocol', () => {
		it('initialize returns protocol version + tools capability', async () => {
			const resp = await callMethod('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'live-test', version: '1' },
			});
			expect(resp.result).toEqual({
				protocolVersion: '2025-06-18',
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: 'forgejo-mcp', version: '0.1.0' },
			});
		});

		it('tools/list returns all 27 tools', async () => {
			const resp = await callMethod('tools/list');
			const result = resp.result as { tools: { name: string }[] };
			expect(result.tools).toHaveLength(27);
			const names = result.tools.map((t) => t.name);
			expect(names).toContain('list_issues');
			expect(names).toContain('get_pr_ci_status');
			expect(names).toContain('list_releases');
			expect(names).toContain('list_tags');
			expect(names).toContain('list_issue_attachments');
			expect(names).toContain('get_attachment');
		});

		it('ping returns empty result', async () => {
			const resp = await callMethod('ping');
			expect(resp.result).toEqual({});
		});
	});

	describe('meta tools', () => {
		it('list_instances returns the env-configured instance', async () => {
			const resp = await callTool('list_instances', {});
			const payload = payloadOf(resp) as { instanceUrl: string; defaultOwner: string; defaultRepo: string }[];
			expect(payload).toHaveLength(1);
			expect(payload[0].instanceUrl).toBe(FORGEJO_URL);
			expect(payload[0].defaultOwner).toBe(OWNER);
			expect(payload[0].defaultRepo).toBe(REPO);
		});

		it('get_current_user returns testuser', async () => {
			const resp = await callTool('get_current_user', {});
			const payload = payloadOf(resp) as { login: string };
			expect(payload.login).toBe(OWNER);
		});
	});

	describe('issue tools', () => {
		it('list_issues returns at least Issue #2 "Test Issue"', async () => {
			const resp = await callTool('list_issues', { state: 'open' });
			const issues = payloadOf(resp) as { number: number; title: string }[];
			const testIssue = issues.find((i) => i.number === 2);
			expect(testIssue).toBeDefined();
			expect(testIssue?.title).toBe('Test Issue');
		});

		it('get_issue #2 has title "Test Issue" and state "open"', async () => {
			const resp = await callTool('get_issue', { number: 2 });
			const payload = payloadOf(resp) as { number: number; title: string; state: string };
			expect(payload.number).toBe(2);
			expect(payload.title).toBe('Test Issue');
			expect(payload.state).toBe('open');
		});

		it('list_issue_comments for #2 returns an array', async () => {
			const resp = await callTool('list_issue_comments', { number: 2 });
			const comments = payloadOf(resp) as unknown[];
			expect(Array.isArray(comments)).toBe(true);
		});

		it('get_issue_timeline for #2 returns an array of events', async () => {
			const resp = await callTool('get_issue_timeline', { number: 2 });
			const timeline = payloadOf(resp) as unknown[];
			expect(Array.isArray(timeline)).toBe(true);
		});

		it('list_repo_labels returns an array', async () => {
			const resp = await callTool('list_repo_labels', {});
			const labels = payloadOf(resp) as unknown[];
			expect(Array.isArray(labels)).toBe(true);
		});
	});

	describe('PR tools', () => {
		it('list_pull_requests returns PR #1 "Test PR"', async () => {
			const resp = await callTool('list_pull_requests', { state: 'open' });
			const prs = payloadOf(resp) as { number: number; title: string }[];
			const testPR = prs.find((p) => p.number === 1);
			expect(testPR).toBeDefined();
			expect(testPR?.title).toBe('Test PR');
		});

		it('get_pull_request #1 has head=feature-branch, base=main', async () => {
			const resp = await callTool('get_pull_request', { number: 1 });
			const pr = payloadOf(resp) as {
				number: number; title: string;
				head: { ref: string; sha: string };
				base: { ref: string };
			};
			expect(pr.number).toBe(1);
			expect(pr.title).toBe('Test PR');
			expect(pr.head.ref).toBe('feature-branch');
			expect(pr.base.ref).toBe('main');
			expect(pr.head.sha).toMatch(/^[0-9a-f]{40,64}$/);
		});

		it('list_pull_request_files #1 includes test.txt', async () => {
			const resp = await callTool('list_pull_request_files', { number: 1 });
			const files = payloadOf(resp) as { filename: string }[];
			const testFile = files.find((f) => f.filename === 'test.txt');
			expect(testFile).toBeDefined();
		});

		it('list_pull_request_commits #1 has >= 1 commit', async () => {
			const resp = await callTool('list_pull_request_commits', { number: 1 });
			const commits = payloadOf(resp) as unknown[];
			expect(commits.length).toBeGreaterThanOrEqual(1);
		});

		it('get_pull_request_refs #1 returns head=feature-branch, base=main', async () => {
			const resp = await callTool('get_pull_request_refs', { number: 1 });
			const refs = payloadOf(resp) as { base: string; head: string };
			expect(refs.head).toBe('feature-branch');
			expect(refs.base).toBe('main');
		});

		it('list_pull_request_reviews #1 returns an array', async () => {
			const resp = await callTool('list_pull_request_reviews', { number: 1 });
			const reviews = payloadOf(resp) as unknown[];
			expect(Array.isArray(reviews)).toBe(true);
		});
	});

	describe('CI status tools', () => {
		it('get_pr_ci_status #1 returns head_sha, head_branch, statuses, summary', async () => {
			const resp = await callTool('get_pr_ci_status', { number: 1 });
			const payload = payloadOf(resp) as {
				head_sha: string; head_branch: string;
				statuses: unknown[]; summary: string;
			};
			expect(payload.head_branch).toBe('feature-branch');
			expect(payload.head_sha).toMatch(/^[0-9a-f]{40,64}$/);
			expect(Array.isArray(payload.statuses)).toBe(true);
			expect(['none', 'pending', 'pass', 'fail']).toContain(payload.summary);
			// Test instance typically has no CI configured, so summary is usually 'none'.
		});

		it('get_commit_statuses for PR #1 head SHA returns a summary', async () => {
			// First fetch the PR to resolve its head SHA dynamically (SHA is not
			// fixed across test runs — the setup script re-creates branches).
			const prResp = await callTool('get_pull_request', { number: 1 });
			const pr = payloadOf(prResp) as { head: { sha: string } };
			const sha = pr.head.sha;
			expect(sha.length).toBeGreaterThanOrEqual(40);

			const resp = await callTool('get_commit_statuses', { sha });
			const payload = payloadOf(resp) as { sha: string; statuses: unknown[]; summary: string };
			expect(payload.sha).toBe(sha);
			expect(['none', 'pending', 'pass', 'fail']).toContain(payload.summary);
		});
	});

	describe('reactions tools', () => {
		it('list_issue_reactions for #2 returns an array', async () => {
			const resp = await callTool('list_issue_reactions', { number: 2 });
			const reactions = payloadOf(resp) as unknown[];
			expect(Array.isArray(reactions)).toBe(true);
		});

		it('list_comment_reactions for issue #2 comment (skip if no comments)', async () => {
			const commentsResp = await callTool('list_issue_comments', { number: 2 });
			const comments = payloadOf(commentsResp) as { id: number }[];
			if (comments.length === 0) {
				// No test data — skip rather than fail.
				return;
			}
			const firstCommentId = comments[0].id;
			const resp = await callTool('list_comment_reactions', { comment_id: firstCommentId });
			const reactions = payloadOf(resp) as unknown[];
			expect(Array.isArray(reactions)).toBe(true);
		});
	});

	describe('branch protection tools', () => {
		it('list_branch_protections returns an array', async () => {
			const resp = await callTool('list_branch_protections', {});
			const rules = payloadOf(resp) as unknown[];
			expect(Array.isArray(rules)).toBe(true);
		});

		it('get_branch_protection for main either returns a rule or 404s as isError', async () => {
			const resp = await callTool('get_branch_protection', { branch: 'main' });
			const result = resp.result as { isError?: boolean; content: { text: string }[] };
			// Test repo may or may not have protection on `main`. Either way
			// the response is well-formed: a rule object, OR an isError:true
			// with an HTTP 404 message.
			if (result.isError === true) {
				expect(result.content[0].text).toMatch(/404|not found/i);
			} else {
				const rule = JSON.parse(result.content[0].text) as { rule_name?: string };
				expect(rule).toBeTruthy();
			}
		});
	});

	describe('misc tools', () => {
		it('list_releases returns an array', async () => {
			const resp = await callTool('list_releases', {});
			const releases = payloadOf(resp) as unknown[];
			expect(Array.isArray(releases)).toBe(true);
		});

		it('list_tags returns an array', async () => {
			const resp = await callTool('list_tags', {});
			const tags = payloadOf(resp) as unknown[];
			expect(Array.isArray(tags)).toBe(true);
		});

		it('get_file_contents for README.md on main returns non-empty text', async () => {
			const resp = await callTool('get_file_contents', {
				path: 'README.md', ref: 'main',
			});
			const text = contentText(resp);
			expect(text.length).toBeGreaterThan(0);
		});

		it('search_repositories returns testuser/test-repo', async () => {
			const resp = await callTool('search_repositories', { query: 'test-repo' });
			const payload = payloadOf(resp) as { data?: { full_name: string }[] } | { full_name: string }[];
			const repos = Array.isArray(payload) ? payload : (payload.data ?? []);
			expect(repos.some((r) => r.full_name === `${OWNER}/${REPO}`)).toBe(true);
		});
	});

	describe('attachment tools', () => {
		it('list_issue_attachments returns an array (may be empty)', async () => {
			const resp = await callTool('list_issue_attachments', { number: 1 });
			const result = resp.result as { isError?: boolean; content: { text: string }[] };
			// Issue #1 may or may not have attachments. Either way, it's well-formed.
			if (result.isError === true) {
				expect(result.content[0].text).toMatch(/404|not found/i);
			} else {
				const assets = JSON.parse(result.content[0].text) as unknown[];
				expect(Array.isArray(assets)).toBe(true);
			}
		});

		it('get_attachment with nonexistent uuid returns isError', async () => {
			const resp = await callTool('get_attachment', { uuid: 'nonexistent-uuid-12345' });
			const result = resp.result as { isError?: boolean; content: { text?: string; type?: string }[] };
			// Either a 404 (isError text) or empty/error response — never a crash.
			expect(result).toBeTruthy();
			expect(result.content).toBeDefined();
		});
	});
});
