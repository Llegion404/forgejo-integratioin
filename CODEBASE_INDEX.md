# Forgejo VS Code Extension — Codebase Index

*Generated: 2026-05-14 | Use this to avoid re-exploring the codebase every session*

---

## Project Overview

**forgejo-vscode** — VS Code extension integrating Forgejo (Gitea, Codeberg). Provides sidebar tree views for PRs, Issues, Actions (CI/CD), and Releases, with rich detail webviews and inline PR code review comments.

- **Runtime**: VS Code Extension API + Node.js built-in `fetch`
- **SDK**: `forgejo-ts` (official Forgejo TypeScript SDK)
- **Entry**: `src/extension.ts` → `./out/extension.js`
- **Activation**: `onStartupFinished`
- **Engine**: `^1.85.0`

---

## Architecture Map

```
src/
├── extension.ts              ← Entry: activate(), registers everything
├── api/
│   └── forgejoClient.ts      ← Wraps forgejo-ts, adds reactions/comment-editing
├── commands/                 ← Self-contained command handlers (unit-testable)
│   ├── registry.ts           ← Type-safe CommandMap + typed register/execute
│   ├── onboarding.ts         ← Wizard: URL → token → name → test
│   ├── instanceManager.ts    ← CRUD quick-pick for instances
│   ├── createIssue.ts        ← Prompt → create issue
│   ├── createPullRequest.ts  ← Branch detect → prompt → create PR
│   ├── createRelease.ts      ← Tags → prompt → create release
│   ├── mergePr.ts            ← Merge method picker → confirm → merge
│   ├── closePr.ts            ← Confirm → close PR
│   ├── selectRemote.ts       ← Pick git remote → associate
│   ├── diagnostics.ts        ← Gather/show diagnostics in output channel
│   └── legacyConfig.ts       ← Deprecated single-instance config commands
├── providers/                ← VS Code extension point implementations
│   ├── prTreeProvider.ts            ← Tree view: PRs grouped Open/Draft/Merged/Closed
│   ├── issueTreeProvider.ts         ← Tree view: Issues grouped Open/Closed
│   ├── actionsTreeProvider.ts       ← Tree view: Workflow runs + jobs + scraped steps
│   ├── releaseTreeProvider.ts       ← Tree view: Releases grouped Released/Prerelease/Draft
│   ├── prDiffContentProvider.ts     ← Virtual doc: forgejo-pr: scheme (file diffs)
│   ├── prDetailsContentProvider.ts  ← Virtual doc: forgejo-pr-details: scheme (markdown)
│   ├── prCommentController.ts       ← CommentController: inline PR review comments
│   └── pendingReviewManager.ts      ← Batches inline comments into review submission
├── models/                   ← Type definitions
│   ├── instance.ts           ← ForgejoInstance, InstanceMatch (extension-specific)
│   ├── issue.ts              ← Re-exports from forgejo-ts
│   ├── pullRequest.ts        ← Re-exports from forgejo-ts
│   ├── action.ts             ← Re-exports from forgejo-ts
│   └── comment.ts            ← PRContext, Reaction, PendingReview + emoji helpers
├── utils/
│   ├── config.ts             ← Read settings, auto-detect instance from git remote
│   ├── gitUtils.ts           ← Parse remote URLs (HTTPS/SSH/SCP), extract owner/repo/host
│   ├── instanceHelpers.ts    ← CRUD + normalize/match/test instances
│   ├── secretStorage.ts      ← Wrap VS Code SecretStorage for tokens
│   ├── logger.ts             ← Singleton Logger on OutputChannel (INFO/WARN/ERROR/DEBUG)
│   ├── forgejoLoggerAdapter.ts  ← Bridges forgejo-ts logger → extension logger
│   └── migration.ts          ← Legacy single-instance → multi-instance, plaintext → SecretStorage
├── webview/                  ← Rich detail panels (client + server)
│   ├── prDetail/provider.ts  ← PR detail webview panel (editable desc, CI, timeline, reactions)
│   ├── issueDetail/provider.ts   ← Issue detail webview panel (labels, timeline, reactions)
│   ├── actionDetail/provider.ts  ← Action detail webview panel (jobs, re-run, logs)
│   ├── shared/helpers.ts     ← escapeHtml, renderMarkdown, formatTimeAgo, timeline renderers
│   ├── prDetail/index.js     ← Client-side JS for PR detail (1261 lines)
│   ├── issueDetail/index.js  ← Client-side JS for Issue detail (923 lines)
│   ├── actionDetail/index.js ← Client-side JS for Action detail (398 lines)
│   ├── prDetail/styles.css   ← PR detail CSS (1097 lines)
│   ├── issueDetail/styles.css
│   └── actionDetail/styles.css
├── __tests__/                ← Jest unit tests
│   ├── setup.ts              ← Mocks global.fetch
│   ├── fixtures/             ← Test fixture data (prActivities, prFiles, prRefs, etc.)
│   ├── utils/                ← Tests for config, gitUtils, instanceHelpers, logger, migration, secretStorage
│   ├── providers/            ← Tests for all 6 providers
│   ├── commands/             ← Tests for all 8 commands
│   ├── api/                  ← Tests for forgejoClient
│   └── webview/helpers.test.ts
└── test/                     ← Integration + E2E tests
    ├── index.ts              ← Mocha runner (recursive discovery)
    ├── suite/                ← Integration tests (Mocha, runs in VS Code)
    └── e2e/                  ← Browser-level Playwright E2E (webview harness)
    └── e2e-vscode/           ← VS Code-level Playwright E2E (real VS Code UI)
```

---

## File-by-File Summary

### Core (`src/extension.ts`)
- **activate(ctx)**: Registers all commands, tree views, content providers, comment controller, webview providers, subscriptions
- **deactivate()**: Cleanup
- Key flow: detects git repo → reads config → auto-matches instance → fetches data → populates trees

### API Layer (`src/api/forgejoClient.ts`)
- Extends `forgejo-ts` `ForgejoClient` with legacy method name aliases
- Adds: `getCommentReactions`, `addCommentReaction`, `deleteCommentReaction`, `getIssueReactions`, `addIssueReaction`, `deleteIssueReaction`, `updateComment`
- Rate-limits `getWorkflowRunDetails` to 1 req/500ms

### Command Registry (`src/commands/registry.ts`)
- `CommandMap` interface: maps each command ID to its argument tuple
- `registerCommand<K>(id, handler)`: typed wrapper
- `executeCommand<K>(id, ...args)`: typed wrapper — catches argument mismatches at compile time
- Context menu handlers accept `(item: TreeItemType | DataType)` union due to VS Code passing tree items

### Tree Providers — Pattern
All four share this pattern:
1. Implement `vscode.TreeDataProvider<T>`
2. `_onDidChangeTreeData` EventEmitter for refresh
3. Lazy-load children on expand (cached on parent item)
4. Group items by state (parent `GroupItem` nodes)
5. Return `MessageItem` for errors/empty states

| Provider | Groups | Children |
|---|---|---|
| `PRTreeProvider` | Open / Draft / Merged / Closed | Per-PR overview → Files |
| `IssueTreeProvider` | Open / Closed | Issues |
| `ActionsTreeProvider` | Workflow runs → Jobs → Steps (scraped) | Lazy per-level |
| `ReleaseTreeProvider` | Released / Prerelease / Draft | Releases |

### Content Providers — Virtual Documents
- `PRDiffContentProvider` (`forgejo-pr:`): Fetches file content at PR ref. Uses `base64url`-encoded refs for tab serialization.
- `PRDetailsContentProvider` (`forgejo-pr-details:`): Renders PR info + CI statuses as markdown.

### Comment Controller (`src/providers/prCommentController.ts`)
- Manages inline PR review comments on `forgejo-pr:` documents
- First comment per thread → "Start a Review" / "Comment directly" prompt
- Uses `PendingReviewManager` for batching

### Pending Review Manager (`src/providers/pendingReviewManager.ts`)
- Singleton. Batches comments → single review submission.
- Status bar item shows pending count. Submit/cancel actions.
- Calls `createReviewWithComments` API on submit.

### Webview Providers — Pattern
All three (`PRDetailWebviewProvider`, `IssueDetailWebviewProvider`, `ActionDetailWebviewProvider`):
1. `Map<string, PanelState>` tracks open panels keyed by `owner/repo/number`
2. Ready/Pending pattern: Extension fetches data immediately, stores as `pendingData`. On webview `ready` message, sends data. On `dispose`, cleans up.
3. Strongly typed message passing: `WebviewMessage` (webview→ext) + `ExtensionMessage` (ext→webview) discriminated unions
4. `_getHtmlForWebview()` constructs HTML with CSP nonces, webview URIs, skeleton loaders, error states

### Key Design Patterns
| Pattern | Where |
|---|---|
| Singleton | `logger`, `pendingReviewManager`, `secretStorage` |
| Type-safe command registry | `commands/registry.ts` with mapped types |
| Provider-based architecture | 6 providers (4 tree, 2 content, 1 comment) |
| Webview panel management | Map-based panel state tracking |
| Lazy-loaded tree children | Cached on parent TreeItem |
| Multi-instance with auto-detect | Config → git remote → best match |
| Migration system | Legacy single-instance → multi, plaintext tokens → SecretStorage |
| Pure functions for testability | `branchNameToTitle`, `parseRemoteUrl`, `normalizeUrl`, `escapeHtml`, etc. |

### Multi-Instance System
- **Storage**: instances in `forgejo.instances` (VS Code settings JSON), tokens in `SecretStorage` (OS keychain, keyed `forgejo-token-{id}`)
- **Auto-detect**: `getForgejoConfig()` → tries manual config → git remote → `findBestInstanceMatch()` (exact URL → domain → default/first)
- **Migration**: `migrateToMultiInstance()` + `migrateTokensToSecretStorage()` run on activation

### MCP Server (`src/mcp/`)
Bundles a Model Context Protocol (MCP) stdio server that exposes Forgejo issues + PRs to AI coding agents (Claude Code, Codex CLI, GitHub Copilot). The server runs as a child process spawned by the agent — not by VS Code — so it cannot read SecretStorage or import `'vscode'`. The default response shape on most tools is **compact + size-bounded** (drops avatar URLs, embedded asset metadata, caps body strings/etc.); pass `full=true` to opt into the raw SDK payload unchanged.

| File | Responsibility |
|---|---|
| `transport.ts` | Hand-rolled newline-delimited JSON-RPC 2.0 stdio transport (~250 lines, no `@modelcontextprotocol/sdk` dep) |
| `config.ts` | `resolveConfig()`: env vars (`FORGEJO_URL`/`TOKEN`/`OWNER`/`REPO`) → `~/.config/forgejo-mcp/instances.json` fallback → throw |
| `client.ts` | `McpForgejoClient extends ForgejoClient` (from `forgejo-ts`) with `noopLogger` — bypasses extension's `forgejoClient.ts` wrapper (which imports `'vscode'`) |
| `server.ts` | `buildMcpServer(transport, clientFactory, configFactory)`: JSON-RPC dispatch for `initialize`/`ping`/`tools/list`/`tools/call`; `runServer()` script entry point |
| `tools/index.ts` | Exports `ALL_TOOLS` array (27 tools) + `findTool(name)`; v2 write tools append here |
| `tools/framework.ts` | `Tool`/`ToolHandler` interfaces, `resolveOwner`/`resolveRepo`/`resolveNumber` helpers, `ImageToolResult` interface (sentinel `{__image: true, data, mimeType, filename?}`) |
| `tools/schema.ts` | JSON Schema builders: `ownerSchema`, `repoSchema`, `numberSchema`, `shaSchema`, `branchSchema`, `pathSchema`, `refSchema`, `commentIdSchema`, `releaseIdSchema`, `uuidSchema`, `issueStateSchema`, `pullRequestStateSchema`, `limitSchema`, `fullSchema` (shared `full: boolean` toggle for compact-by-default tools), `objectSchema()` |
| `tools/{meta,repositories,issues,pullRequests}.ts` | Tool groups: `list_instances`, `get_current_user`, `search_repositories`, `list_issues`, `get_issue` (default fan-out issue + comments + assets in parallel, compact envelope with `_meta`), `list_issue_comments` (compact ConversationSummary), `get_issue_timeline`, `list_repo_labels`, `list_pull_requests` (compact PrListItem[]), `get_pull_request` (default returns the multi-section compact bundle that used to be `get_pull_request_summary`: description/commits/conversation/files_overview + opt-in reviews/ci_status; `full=true` returns raw PR only), `list_pull_request_files`, `list_pull_request_commits` (compact CommitsSummary), `get_pull_request_refs`, `list_pull_request_reviews` (compact), `list_review_comments` |
| `tools/ciStatus.ts` | 2 tools: `get_pr_ci_status` (resolves PR head SHA → getCommitStatuses → dedup → summary), `get_commit_statuses` (raw SHA) |
| `tools/reactions.ts` | 2 read tools via `rawRequest`: `list_comment_reactions`, `list_issue_reactions` |
| `tools/branchProtection.ts` | 2 tools via `rawRequest`: `list_branch_protections`, `get_branch_protection` |
| `tools/attachments.ts` | 2 tools: `list_issue_attachments` (rawRequest GET `/issues/{n}/assets`), `get_attachment` (fetch bytes → `ImageToolResult` → server emits MCP `{type:'image'}` content block) |
| `tools/misc.ts` | 4 tools: `list_releases` (compact ReleaseSummary[]), `get_release` (compact), `get_file_contents`, `list_tags`. Default shapes drop tarball_url/zipball_url/browser_download_url; pass `full=true` for the raw SDK object. |
| `utils/responseFormat.ts` | Pure helpers: `truncateText`, `truncatePatch`, `shortSha`, `compactUser` (returns `{login, full_name?}`), `commitSubject`, `totalAdditions`, `totalDeletions`; section summarizers — `summarizePrDescription`, `summarizeCommits`, `summarizeComments`, `summarizeFilesOverview`, `summarizeReviews`, `summarizeIssue` (compact Issue shape with attachments + dates), `summarizeIssueListItem`, `summarizePrListItem`, `summarizeRelease`; `clampInt`/`readBool` arg helpers — no `vscode` imports |
| `utils/statusDedup.ts` | Pure helpers copied from extension: `deduplicateStatuses()`, `summarizeStatuses()` — no `vscode` imports |

**Why no `@modelcontextprotocol/sdk`:** The official SDK pulls ~5-10MB of transitive deps (express, hono, jose, ajv, zod, pkce-challenge) and its `exports` field is incompatible with `moduleResolution: "node"`. The hand-rolled transport is fully testable and adds zero deps.

**Config resolution order:** env vars → `instances.json` file (written by the export command) → throw. `getConfigFilePath()` prefers `process.env.HOME` over `os.homedir()` because Linux's `os.homedir()` ignores `$HOME`.

### MCP Config Export (`src/commands/exportMcpConfig.ts`)
The `forgejo.exportMcpConfig` command writes per-agent config files so AI agents can spawn the stdio MCP server:
- Reads current instance URL + token from `getForgejoConfig()`
- Warns user about plaintext token write (modal)
- Multi-select quickpick of agents (Copilot / Claude Code / Codex)
- Writes `.vscode/mcp.json` (Copilot), `.mcp.json` (Claude Code), `.codex/config.toml` (Codex) with `env` block containing `FORGEJO_URL`/`FORGEJO_TOKEN`/`FORGEJO_OWNER`/`FORGEJO_REPO`
- Writes `~/.config/forgejo-mcp/instances.json` as a non-VS-Code-launched fallback

Pure helpers (`buildEnvBlockJson`, `buildEnvBlockToml`, `buildAgentConfig`, `getAgentConfigPath`, `writeInstancesFile`) are exported for unit testing.

---

## Testing Infrastructure

### Three Tiers

| Tier | Framework | Location | Run Command | Requires |
|---|---|---|---|---|
| Unit | Jest 29 | `src/__tests__/**/*.test.ts` | `npm run test:unit` | Nothing |
| Integration | Mocha + `@vscode/test-cli` | `src/test/suite/*.test.ts` | `npm run test:integration` | VS Code |
| E2E (browser) | Playwright | `src/test/e2e/*.spec.ts` | `npm run test:e2e` | Chromium |
| E2E (VS Code) | Playwright + `vscode-test-playwright` | `src/test/e2e-vscode/*.spec.ts` | `npm run test:e2e:vscode` | VS Code |
| Live API | Jest | `src/__tests__/**/*.live.test.ts` | `npm run test:live` | Forgejo instance |
| Live E2E | Playwright | `src/test/e2e-vscode/*-live.spec.ts` | `npm run test:e2e:live` | Docker Forgejo |

### Unit Test Structure
- **Mock**: `__mocks__/vscode.js` provides fake VS Code API; mapped via `moduleNameMapper` in jest.config.js
- **Setup**: `src/__tests__/setup.ts` mocks `global.fetch` with `jest-fetch-mock`
- **Coverage threshold**: 55% statements/branches/functions/lines
- **Exclusions**: Models (interfaces), extension.ts, webview providers (need VS Code APIs)

### Key Test Files
- `forgejoClient.test.ts` — API client methods with mocked fetch
- `prTreeProvider.test.ts` — Tree item creation, file sorting, caching
- `prDiffContentProvider.test.ts` — URI parsing, content fetching, caching
- `instanceManager.test.ts` — Multi-instance CRUD flows
- `migration.test.ts` — Legacy config migration
- `config.test.ts` — Config resolution, auto-detect
- `gitUtils.test.ts` — Remote URL parsing (all formats)
- `mcp/config.test.ts` — Env precedence, file fallback, $XDG_CONFIG_HOME resolution
- `mcp/transport.test.ts` — JSON-RPC parsing, mock stdin/stdout, partial-buffer, error responses
- `mcp/tools.test.ts` — All 25 tool handlers against mocked `McpForgejoClient`
- `mcp/statusDedup.test.ts` — Dedup (12→6), summary precedence (fail > pending > pass > none), edge cases
- `mcp/ciStatus.test.ts` — `get_pr_ci_status` SHA resolution + dedup, `get_commit_statuses` summary
- `mcp/reactions.test.ts` — Comment/issue reaction URL paths, URL-encoding, error wrapping
- `mcp/branchProtection.test.ts` — Branch protection paths, URL-encoding of slashes in branch names
- `mcp/misc.test.ts` — `list_releases`/`get_release`/`get_file_contents`/`list_tags` SDK method wiring
- `mcp/server.live.test.ts` — Live integration (~26 tests) against Docker Forgejo + setup-script fixtures; auto-skips without env vars
- `commands/exportMcpConfig.test.ts` — Agent config generation (JSON/TOML), command body integration

---

## Command Index

| Command ID | Handler File | Description |
|---|---|---|
| `forgejo.addInstance` | `onboarding.ts` | Add new instance wizard |
| `forgejo.manageInstances` | `instanceManager.ts` | List/add/edit/remove/test instances |
| `forgejo.showDiagnostics` | `diagnostics.ts` | Show diagnostic info |
| `forgejo.showOutput` | `extension.ts` | Show output channel |
| `forgejo.refreshPullRequests` | `extension.ts` | Refresh PR tree |
| `forgejo.refreshIssues` | `extension.ts` | Refresh issues tree |
| `forgejo.refreshActions` | `extension.ts` | Refresh actions tree |
| `forgejo.refreshReleases` | `extension.ts` | Refresh releases tree |
| `forgejo.configureInstanceUrl` | `legacyConfig.ts` | Set legacy URL |
| `forgejo.setAuthToken` | `legacyConfig.ts` | Set legacy token |
| `forgejo.selectRemote` | `selectRemote.ts` | Pick git remote |
| `forgejo.createIssue` | `createIssue.ts` | Create issue |
| `forgejo.createPullRequest` | `createPullRequest.ts` | Create PR |
| `forgejo.createRelease` | `createRelease.ts` | Create release |
| `forgejo.exportMcpConfig` | `exportMcpConfig.ts` | Write MCP server config for AI agents (Copilot/Claude/Codex) |
| `forgejo.mergePr` | `mergePr.ts` | Merge PR |
| `forgejo.closePr` | `closePr.ts` | Close PR |
| `forgejo.showPrDetails` | `webview/prDetail/provider.ts` | Open PR detail webview |
| `forgejo.showIssueDetails` | `webview/issueDetail/provider.ts` | Open issue detail webview |
| `forgejo.showActionDetails` | `webview/actionDetail/provider.ts` | Open action detail webview |
| `forgejo.openPrInBrowser` | `extension.ts` | Open PR in browser |
| `forgejo.openIssueInBrowser` | `extension.ts` | Open issue in browser |
| `forgejo.openReleaseInBrowser` | `extension.ts` | Open release in browser |
| `forgejo.showPrFileDiff` | `prDiffContentProvider.ts` | Show file diff |
| `forgejo.submitInlineComment` | `prCommentController.ts` | Submit comment |
| `forgejo.viewStepLogs` | `actionsTreeProvider.ts` | View step logs |
| `forgejo.rerunAction` | `actionsTreeProvider.ts` | Re-run workflow |

---

## Cross-File Data Flow

```
Activation (extension.ts)
  ├── Config + Instance resolution (config.ts → gitUtils.ts → instanceHelpers.ts → secretStorage.ts)
  ├── Migration (migration.ts)
  ├── Register commands (registry.ts → command handlers)
  ├── Register tree providers (prTreeProvider, issueTreeProvider, actionsTreeProvider, releaseTreeProvider)
  ├── Register content providers (prDiffContentProvider, prDetailsContentProvider)
  ├── Register comment controller (prCommentController + pendingReviewManager)
  └── Register webview providers (prDetail/issueDetail/actionDetail providers)

Tree Provider Refresh
  → getForgejoConfig() → resolves owner/repo
  → forgejoClient.getPullRequests() / getIssues() / getWorkflowRuns() / getReleases()
  → Creates tree items with GroupItem parents

Webview Panel Open
  → provider.ts resolveWebviewView/resolveWebview
  → Fetches details via forgejoClient
  → Constructs HTML with inline JS/CSS (webview URIs)
  → Ready/Pending pattern sends data on webview ready message

Inline Comment
  → prCommentController handles comment thread creation
  → pendingReviewManager batches comments
  → On submit: forgejoClient.createReviewWithComments()

MCP Server (stdio child process spawned by AI agent)
  → Agent writes .vscode/mcp.json / .mcp.json / .codex/config.toml (via exportMcpConfig command)
  → Agent spawns `node <ext>/out/mcp/server.js` with FORGEJO_URL/TOKEN/OWNER/REPO env vars
  → server.ts: buildMcpServer() reads JSON-RPC from stdin, dispatches initialize/ping/tools/list/tools/call
  → tools/*: each tool calls McpForgejoClient (extends forgejo-ts ForgejoClient) → writes JSON-RPC response to stdout
  → Fallback: if env vars unset, config.ts reads ~/.config/forgejo-mcp/instances.json
```

---

## Key Files by Layer

| Layer | Files |
|---|---|
| Extension Shell | `extension.ts` |
| API Client | `forgejoClient.ts` (wraps forgejo-ts) |
| Config | `config.ts` + `gitUtils.ts` |
| Instance Mgmt | `instanceHelpers.ts` + `secretStorage.ts` + `migration.ts` |
| Commands | `registry.ts` + 9 handler files |
| MCP Server | `mcp/{transport,config,client,server}.ts` + `mcp/utils/statusDedup.ts` + `mcp/tools/{schema,framework,meta,repositories,issues,pullRequests,ciStatus,reactions,branchProtection,misc,index}.ts` |
| Tree Views | 4 `*TreeProvider.ts` files |
| Virtual Docs | 2 `*ContentProvider.ts` files |
| Comments | `prCommentController.ts` + `pendingReviewManager.ts` |
| Webviews | 3 `webview/*/provider.ts` + 3 `index.js` + 3 `styles.css` + `webview/shared/helpers.ts` |
| Models | 5 `models/*.ts` files |
| Utils | 6 `utils/*.ts` files |
| Unit Tests | 30+ files in `src/__tests__/` (incl. `mcp/` subfolder for transport/config/tools/ciStatus/reactions/branchProtection/misc/statusDedup, `commands/exportMcpConfig.test.ts`, plus `mcp/server.live.test.ts` for live integration) |
| Integration Tests | 4 files in `src/test/suite/` |
| E2E Tests | 10+ files in `src/test/e2e/` + `src/test/e2e-vscode/` |

---

## Common Troubleshooting

| Issue | Likely Cause | Fix Location |
|---|---|---|
| Views not showing | Activation event wrong | `package.json` → `activationEvents: onStartupFinished` |
| "No Forgejo config" | Missing remote / not a git repo | Check `gitUtils.ts` parsing, `config.ts` resolution |
| PRs in Issues view | API returns PRs from `/issues` | `forgejoClient.ts`: filter by `pull_request` field |
| SSH URL not recognized | Regex doesn't match format | `gitUtils.ts` → `parseRemoteUrl()` |
| Auth fails | Token scope or storage | `secretStorage.ts` → check token retrieval |
| Webview blank | CSP blocking inline scripts | `provider.ts` → `_getHtmlForWebview()` nonces |
| Diff not loading | base64url ref decode fails | `prDiffContentProvider.ts` → `decodeBase64UrlSafe()` |
