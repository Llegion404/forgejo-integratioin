# Plan: Fill MCP Read-Coverage Gaps + Live Integration Tests

## Goal

Two parallel pieces of work for the v1 read-only MCP server:

1. **Coverage gaps in the read surface** — Add 10 new read-only tools covering CI status, reactions, branch protection, and the SDK-typed "misc" reads (releases, file contents, tags). Tool count goes from 15 → 25.
2. **Live integration tests against a real Forgejo instance** — Drive `buildMcpServer()` against a real `McpForgejoClient` (no mocks) using the existing Docker + setup-script infrastructure. Verify the entire wire path from JSON-RPC dispatch to Forgejo REST to typed response.

Read-only remains the contract. No mutations, no token secret handling changes. v2 (write tools) is not started here.

## Approach

- **Reuse existing SDK methods when typed.** `getCommitStatuses`, `listReleases`, `getRelease`, `getFileContents`, `listTags` all already exist on `forgejo-ts`'s `ForgejoClient` and are inherited by `McpForgejoClient`.
- **Use `rawRequest` for what the SDK doesn't type.** Reactions and branch-protection endpoints have no SDK methods — copy the same `rawRequest('METHOD', path, body?)` pattern the extension's wrapper already uses at `src/api/forgejoClient.ts:78-100`.
- **Reuse `buildMcpServer()`'s DI seam for live tests** — it takes `clientFactory` and `configFactory` functions, so the live test just swaps the mocked client for a real one (built from `FORGEJO_TEST_URL` + `FORGEJO_TEST_TOKEN`). No new test plumbing needed; the existing Docker compose + `setup-forgejo-test.sh` already creates PR #1 "Test PR" + Issue #2 "Test Issue" in `testuser/test-repo`.
- **Copy a single pure helper verbatim** — `deduplicateStatuses` from `src/providers/prDetailsContentProvider.ts:119-132` (CI endpoint returns all historical records including initial 'pending' state; collapsing by context keeping latest `created_at` is mandatory before exposing to agents).

## Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `src/mcp/utils/statusDedup.ts` | Pure helper — `deduplicateStatuses(statuses: CommitStatus[]): CommitStatus[]`. Copied verbatim from `src/providers/prDetailsContentProvider.ts:119-132`. Also exports `summarizeStatuses(statuses): 'none'\|'pending'\|'fail'\|'pass'` (precedence: any-failure > any-pending > else-pass). |
| 2 | `src/mcp/tools/ciStatus.ts` | 2 tools: `get_pr_ci_status` (PR-number-keyed, internally resolves head SHA + dedups) and `get_commit_statuses` (raw-SHA-keyed). |
| 3 | `src/mcp/tools/reactions.ts` | 2 read tools: `list_comment_reactions` and `list_issue_reactions`. Both via `rawRequest('GET', ...)`. |
| 4 | `src/mcp/tools/branchProtection.ts` | 2 tools: `list_branch_protections` and `get_branch_protection`. Both via `rawRequest('GET', ...)`. |
| 5 | `src/mcp/tools/misc.ts` | 4 tools: `list_releases`, `get_release`, `get_file_contents`, `list_tags`. All wrap SDK methods directly. |
| 6 | `src/__tests__/mcp/tools/ciStatus.test.ts` | Unit tests (mocked `McpForgejoClient`): dedup collapses 12-record fixture → 6, `get_pr_ci_status` correctly resolves head SHA from mocked PR response, `summary` returns correct precedence, error paths. |
| 7 | `src/__tests__/mcp/tools/reactions.test.ts` | Unit tests: URL-encoding of comment_id, correct GET path for issue vs. comment reactions, error wrapping as `isError: true`. |
| 8 | `src/__tests__/mcp/tools/branchProtection.test.ts` | Unit tests: correct path with/without `{branch}` segment, URL-encoding of branch name, 404 wrapping. |
| 9 | `src/__tests__/mcp/tools/misc.test.ts` | Unit tests: `list_releases` paginates, `get_release` requests by id, `get_file_contents` passes `ref` query param, `list_tags` returns `Tag[]`. |
| 10 | `src/__tests__/mcp/utils/statusDedup.test.ts` | Copy of `prDetailsContentProvider.test.ts:295-390`'s 5 dedup tests adapted to test the standalone function. |
| 11 | `src/__tests__/mcp/server.live.test.ts` | Live integration test: drives `buildMcpServer()` against a real `McpForgejoClient` using the Docker-compose Forgejo instance + setup-script fixtures. `describe.skip` when env vars unset (mirrors `forgejoClient.live.test.ts`). |

## Files to Modify

| # | File | Change |
|---|------|--------|
| 12 | `src/mcp/tools/index.ts` | Import new tool groups; concatenate `ciStatusTools`, `reactionTools`, `branchProtectionTools`, `miscTools` into `ALL_TOOLS`. Count goes 15 → 25. |
| 13 | `src/mcp/tools/schema.ts` | Add `shaSchema` (string, minLength 40, `^Description: 40-64 char hex commit SHA`), `branchSchema` (string, minLength 1), `pathSchema` (string, minLength 1), `refSchema` (string, minLength 1), `commentIdSchema` (integer, minimum 1), `releaseIdSchema` (integer, minimum 1). |
| 14 | `package.json` | Broaden `test:live` regex from `forgejoClient\\.live\\.test` to `\\.live\\.test` so the new `server.live.test` file is picked up. |
| 15 | `README.md` | Update the "MCP Server for AI Agents" tools table to include the 10 new tools across CI / Reactions / Branch Protection / Misc groups. |
| 16 | `CODEBASE_INDEX.md` | Update tool count in 3 places (15 → 25); add new tool-group files to the mcp/tools table; mention `server.live.test.ts` in Key Test Files. |
| 17 | `src/mcp/server.ts` | Header comment update: "15 tools" → "25 tools". No logic changes. |

## Tool Definitions

### Group 1: CI Status (`src/mcp/tools/ciStatus.ts`)

**Tool 1: `get_pr_ci_status`**
```ts
{
  name: 'get_pr_ci_status',
  description: 'Fetch CI check runs for the head SHA of a pull request. ' +
    'Returns the deduplicated latest status per context (collapse ' +
    'pending/success pairs), the head sha, head branch, and a summary ' +
    'verdict (pass/fail/pending/none). Use this instead of ' +
    'get_commit_statuses when you only know the PR number.',
  inputSchema: {
    type: 'object',
    properties: { owner, repo, number: numberSchema },
    required: ['owner', 'repo', 'number'],
  },
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    const prNumber = resolveNumber(args, 'number');
    const pr = await client.getPullRequest(owner, repo, prNumber);
    const sha = pr.head.sha;
    const raw = sha
      ? await client.getCommitStatuses(owner, repo, sha)
      : [];
    const statuses = deduplicateStatuses(raw);
    return {
      head_sha: sha,
      head_branch: pr.head.ref,
      statuses,
      summary: summarizeStatuses(statuses),
    };
  },
}
```

**Tool 2: `get_commit_statuses`**
```ts
{
  name: 'get_commit_statuses',
  description: 'Fetch CI check runs for a specific commit SHA. Returns ' +
    'deduplicated statuses (latest per context). Use the 40-char commit ' +
    'SHA, not a branch name or ref. Call get_pr_ci_status instead if you ' +
    'only know the PR number.',
  inputSchema: {
    type: 'object',
    properties: { owner, repo, sha: shaSchema },
    required: ['owner', 'repo', 'sha'],
  },
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    const sha = String(args['sha']);
    const raw = await client.getCommitStatuses(owner, repo, sha);
    return {
      sha,
      statuses: deduplicateStatuses(raw),
      summary: summarizeStatuses(deduplicateStatuses(raw)),
    };
  },
}
```

### Group 2: Reactions (`src/mcp/tools/reactions.ts`)

**Tool 3: `list_comment_reactions`**
```ts
{
  name: 'list_comment_reactions',
  description: 'List emoji reactions on a PR or issue comment. Each ' +
    'returned entry has { id, user: { login, avatar_url }, reaction }. ' +
    'Reaction values are Forgejo/Gitea strings: +1, -1, laugh, hooray, ' +
    'confused, heart, rocket, eyes.',
  inputSchema: {
    type: 'object',
    properties: { owner, repo, comment_id: commentIdSchema },
    required: ['owner', 'repo', 'comment_id'],
  },
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    const commentId = resolveNumber(args, 'comment_id');
    return client.rawRequest('GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${commentId}/reactions`);
  },
}
```

**Tool 4: `list_issue_reactions`**
```ts
{
  name: 'list_issue_reactions',
  description: 'List emoji reactions attached directly to an issue body ' +
    '(not a comment). Same shape as list_comment_reactions.',
  inputSchema: {
    type: 'object',
    properties: { owner, repo, number: numberSchema },
    required: ['owner', 'repo', 'number'],
  },
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    const issueNumber = resolveNumber(args, 'number');
    return client.rawRequest('GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/reactions`);
  },
}
```

Note: The path `/issues/{number}/reactions` uses the issue **number** (URL-visible), the same identifier used by `get_issue`. Confirmed by `src/webview/issueDetail/provider.ts:144` in the existing extension.

### Group 3: Branch Protection (`src/mcp/tools/branchProtection.ts`)

**Tool 5: `list_branch_protections`**
```ts
{
  name: 'list_branch_protections',
  description: 'List all branch protection rules in a repository. Each ' +
    'rule defines which branches are protected and the required reviews, ' +
    'status checks, and push restrictions for direct commits.',
  inputSchema: objectSchema({ owner, repo }, ['owner', 'repo']),
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    return client.rawRequest('GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branch_protections`);
  },
}
```

**Tool 6: `get_branch_protection`**
```ts
{
  name: 'get_branch_protection',
  description: 'Get the protection rule for a specific branch (e.g. main, ' +
    'master, release/*). Returns the full rule object including ' +
    'required_approvals, enable_status_check, required_status_checks, ' +
    'enable_push_whitelist, etc.',
  inputSchema: {
    type: 'object',
    properties: { owner, repo, branch: branchSchema },
    required: ['owner', 'repo', 'branch'],
  },
  async handler({ args, client, config }) {
    const owner = resolveOwner(args, config);
    const repo = resolveRepo(args, config);
    const branch = String(args['branch']);
    return client.rawRequest('GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branch_protections/${encodeURIComponent(branch)}`);
  },
}
```

### Group 4: Misc (`src/mcp/tools/misc.ts`)

**Tool 7: `list_releases`** — wraps `client.listReleases(owner, repo)`. Auto-paginated. Returns `Release[]` with tag_name, name, body (markdown), draft, prerelease, created_at, published_at, assets.

**Tool 8: `get_release`** — input: `owner`, `repo`, `id` (integer). Wraps `client.getRelease(owner, repo, id)`.

**Tool 9: `get_file_contents`** — input: `owner`, `repo`, `path` (string), `ref` (string, e.g. branch or SHA). Wraps `client.getFileContents(owner, repo, path, ref)`. Returns decoded file content as string. Note: `ref` is required (no optional overloads in the SDK).

**Tool 10: `list_tags`** — wraps `client.listTags(owner, repo)`. Returns `Tag[]` with name, commit.sha, etc.

## Schema Additions (`src/mcp/tools/schema.ts`)

```ts
export const shaSchema: JsonSchema = {
  type: 'string',
  description: '40 or 64 character hex commit SHA (not a branch name or ref)',
  minLength: 40,
};

export const branchSchema: JsonSchema = {
  type: 'string',
  description: 'Git branch name (e.g. main, master, release/1.0)',
  minLength: 1,
};

export const pathSchema: JsonSchema = {
  type: 'string',
  description: 'Path to a file in the repository (relative to repo root)',
  minLength: 1,
};

export const refSchema: JsonSchema = {
  type: 'string',
  description: 'Git ref (branch name, tag, or commit SHA)',
  minLength: 1,
};

export const commentIdSchema: JsonSchema = {
  type: 'integer',
  description: 'Numeric comment id (from list_issue_comments)',
  minimum: 1,
};

export const releaseIdSchema: JsonSchema = {
  type: 'integer',
  description: 'Numeric release id (from list_releases)',
  minimum: 1,
};
```

## Helper: `src/mcp/utils/statusDedup.ts`

```ts
import type { CommitStatus } from '../types';  // <-- re-export of forgejo-ts CommitStatus type

export function deduplicateStatuses(statuses: CommitStatus[]): CommitStatus[] {
  const latestByContext = new Map<string, CommitStatus>();
  for (const status of statuses) {
    const key = status.context;
    const statusDate = new Date(status.created_at).getTime();
    if (isNaN(statusDate)) continue;
    const existing = latestByContext.get(key);
    const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
    if (statusDate > existingDate) {
      latestByContext.set(key, status);
    }
  }
  return Array.from(latestByContext.values());
}

export type StatusSummary = 'none' | 'pending' | 'fail' | 'pass';

export function summarizeStatuses(statuses: CommitStatus[]): StatusSummary {
  if (statuses.length === 0) return 'none';
  for (const s of statuses) {
    if (s.status === 'error' || s.status === 'failure') return 'fail';
  }
  for (const s of statuses) {
    if (s.status === 'pending' || s.status === 'warning') return 'pending';
  }
  return 'pass';
}
```

**CommitStatus shape import strategy:** Re-export the type from the SDK. Add to `src/mcp/client.ts` or a new `src/mcp/types.ts`:
```ts
export type { CommitStatus } from 'forgejo-ts';
```
This avoids importing `.js` runtime from the SDK, keeping the MCP server decoupled.

## Live Integration Test: `src/__tests__/mcp/server.live.test.ts`

### Setup pattern (copied from `forgejoClient.live.test.ts`)
- `jest.unmock('../../../utils/logger')` — same guard, even though MCP server doesn't import the logger (defensive in case any transitive dep does).
- Reads `FORGEJO_TEST_URL` / `FORGEJO_TEST_TOKEN` from `process.env`.
- `describeIfLive = FORGEJO_TEST_URL && FORGEJO_TEST_TOKEN ? describe : describe.skip`.
- `beforeAll`: import `undici`, swap `global.fetch = undici.fetch` (because `setup.ts` mocks `global.fetch = jest.fn()`), create `McpInstanceConfig { instanceUrl, token, defaultOwner: 'testuser', defaultRepo: 'test-repo' }`, build `client = createClient(config)`.
- `afterAll`: restore saved `global.fetch`.
- Helper: `callTool(name, args)` — creates a `fakeTransport` (matches the shape in `tools.test.ts`), wires `buildMcpServer(transport, () => client, () => config)`, invokes `transport.onMessage(request)`, returns the JSON-RPC response.

### Test cases (≈ 15 tests, all live)
| # | Tool | Assertion |
|---|------|-----------|
| 1 | `initialize` | Response has `protocolVersion: '2025-06-18'`, `serverInfo.name: 'forgejo-mcp'`, `capabilities.tools`. |
| 2 | `tools/list` | Returns 25 tools. |
| 3 | `list_instances` | Returns 1 instance matching FORGEJO_TEST_URL. |
| 4 | `get_current_user` | Response `login === 'testuser'`. |
| 5 | `search_repositories` | Returns at least 1 repo named `test-repo`. |
| 6 | `list_issues` (state=open) | Issue #2 in result array with title "Test Issue". |
| 7 | `get_issue` (number=2) | `number === 2`, `title === 'Test Issue'`, `state === 'open'`. |
| 8 | `list_pull_requests` (state=open) | PR #1 in result array with title "Test PR". |
| 9 | `get_pull_request` (number=1) | `number === 1`, `head.ref === 'feature-branch'`, `base.ref === 'main'`, head.sha is 40-char hex. |
| 10 | `list_pull_request_files` (number=1) | Includes a file named `test.txt`. |
| 11 | `get_pull_request_refs` (number=1) | `head: 'feature-branch'`, `base: 'main'`. |
| 12 | `list_pull_request_commits` (number=1) | Length >= 1. |
| 13 | `get_pr_ci_status` (number=1) | Returns `{ head_sha, head_branch, statuses, summary }`; `head_branch === 'feature-branch'`; `summary === 'none'` (test instance has no CI). |
| 14 | `get_commit_statuses` (sha from #9) | Returns `{ sha, statuses, summary }`; `summary === 'none'`. |
| 15 | `list_releases` | Returns an array (can be empty). |
| 16 | `list_tags` | Returns an array (server-side may have 0 or more). |
| 17 | `get_file_contents` (path=`README.md`, ref=`main`) | Returns a non-empty string containing "test-repo" or # heading. |
| 18 | `list_branch_protections` | Returns an array (likely empty on test repo). |
| 19 | `list_issue_reactions` (number=2) | Returns an array (likely empty). |
| 20 | `list_comment_reactions` (comment_id from #6 of issue #2's comments, or skip if none) | Returns an array. |

For tests requiring resource IDs that don't exist on the test fixture (e.g. `comment_id`), skip with `it.skip('no test data')` rather than fail.

### How to run locally

```bash
docker compose -f docker-compose.e2e.yml up -d --wait
bash scripts/setup-forgejo-test.sh   # exports FORGEJO_TEST_TOKEN; creates testuser/test-repo + PR #1 + Issue #2
export FORGEJO_TEST_URL=http://localhost:3000
npm run test:live                    # <-- after package.json regex change
```

## Unit Test Plan (4 new test files + 1 util test file)

For each new tool file, follow the existing pattern in `src/__tests__/mcp/tools.test.ts`:

### `src/__tests__/mcp/tools/ciStatus.test.ts`
- Mock `McpForgejoClient` so `getPullRequest` returns `{ head: { sha: 'abc...123', ref: 'feature' } }` and `getCommitStatuses` returns the `mockDuplicateStatuses` fixture from `src/__tests__/fixtures/commitStatuses.ts`.
- Assert that after dedup, only 6 statuses remain (instead of 12) and `summary === 'pass'`.
- Test `get_commit_statuses` in isolation with `mockMixedStatuses` (a fail + pass set) → summary = `'fail'`.
- Test: `getPullRequest` throws → response has `isError: true` and the error message.

### `src/__tests__/mcp/tools/reactions.test.ts`
- Assert URL paths called on `rawRequest`:
  - `list_comment_reactions` → `/repos/{owner}/{repo}/issues/comments/{id}/reactions`
  - `list_issue_reactions` → `/repos/{owner}/{repo}/issues/{issueNumber}/reactions`
- Test URL-encoding of repo names with slashes (unlikely but defensive).
- Test error wrapping: 404 → `isError: true`.

### `src/__tests__/mcp/tools/branchProtection.test.ts`
- Assert paths called:
  - `list_branch_protections` → `/repos/{owner}/{repo}/branch_protections`
  - `get_branch_protection` → `/repos/{owner}/{repo}/branch_protections/{branch}`
- Test URL-encoding of branch names with `/` (e.g. `release/1.0` becomes `release%2F1.0`).

### `src/__tests__/mcp/tools/misc.test.ts`
- Assert SDK method names invoked (mock `listReleases`, `getRelease`, `getFileContents`, `listTags` on `McpForgejoClient`).
- Verify `getFileContents` receives `(owner, repo, path, ref)` in correct order.

### `src/__tests__/mcp/utils/statusDedup.test.ts`
- Copy tests from `src/__tests__/providers/prDetailsContentProvider.test.ts:295-390` (5 tests):
  1. Collapses 12-record `mockDuplicateStatuses` to 6 unique contexts.
  2. No 'pending' summaries remain after dedup (the pending entries get superseded).
  3. Unsorted input is stable.
  4. Identical `created_at` timestamps keep the first-seen entry (`>` not `>=`).
  5. Entries with `created_at: 'invalid-date'` are filtered out.

## Verification

After every step:

1. `npm run compile` — must pass with no TS errors.
2. `npm run lint` — must not introduce new eslint errors on touched files.
3. `npx jest --testPathPattern='mcp/'` — all unit tests pass (existing 58 + new misc/unit files).
4. After adding all 4 tool groups: `npm run test:unit` — full suite still mostly green (existing 4 provider test failures on master are unrelated to MCP).
5. After `package.json` change: `npm run test:live` against the Docker Forgejo instance — all live tests pass.
6. `vsce package --allow-missing-repository` — produces `forgejo-vscode-0.3.18.vsix` (size will grow slightly, ~12 MB).
7. Per AGENTS.md (now simplified): ask the user before installing the VSIX.

## Out of Scope (deferred to follow-up)

- v2 write tools (create_issue, merge_pr, submit_review, etc.) — explicitly marked for v2 by `src/mcp/tools/index.ts:4-7` comment.
- Add/remove reaction tools — only the read paths are added.
- Branch protection rule create/update — read paths only.
- `add_reaction`, `remove_reaction`, `request_reviewers` POST/DELETE — all mutations deferred.
- Supporting the Gitea `/commits/{sha}/statuses` alternate endpoint — `getCommitStatuses` already uses the equivalent `/statuses/{sha}` form.
- `/check-runs` endpoint (Forgejo has unified this under the statuses response; no separate typed SDK method exists).
- Exposure of `actions/runs` (workflow runs list) — already covered by the extension's Actions sidebar tree, less useful for AI agents currently.

## Risk / Notes

- **Test fixture interdependency**: PR #1's `head.sha` is dynamic — branch `feature-branch` may get force-pushed by an earlier test run. The setup script is idempotent but does not preserve the SHA. Live test #9 must extract the SHA from `get_pull_request` first, then pass it to `get_commit_statuses` in test #14. Use the same dynamic SHA pass-through.
- **`getFileContents` requires `ref`**: the SDK enforces it (no overload). The MCP tool schema makes `ref` required. If the agent doesn't know the default branch, it must read repositories first or guess 'main'. This matches Forgejo conventions.
- **`list_branch_protections` might return 404 on test repo**: Forgejo returns an empty array for repos with no protections — confirmed by extension behavior in `actionsTreeProvider.ts`. No special handling needed.
- **`rawRequest` return type is `unknown`**: JSON-RPC serialization happens in `buildMcpServer:185` via `JSON.stringify(result)`. If a tool returns a non-serializable object (e.g. `BigInt`), it'll throw. Forgejo REST responses are all JSON-native, so this is fine.
- **Tool count growth: 15 → 25**: the `tools/list` response grows from ~2KB to ~3.5KB. MCP clients usually cache this; no token-cost concern.
