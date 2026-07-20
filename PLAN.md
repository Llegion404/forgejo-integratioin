# Forgejo VS Code Extension — Perfection Plan

**Scope decided with user:**
- **MCP** = Read-only perfection (no mutation tools; fix all bugs/edge cases + add workflow/CI + search tools)
- **UI** = Full parity (4 phases including new top-level surfaces)

Audits produced a clear, exhaustive gap list. This plan converts them into ordered, verifiable work.

---

# PART A — MCP Perfection (owner: ocx)

The MCP server today is a solid v1 with **27 read-only tools** but ships with several HIGH-severity correctness bugs, no DoS protection, and zero coverage of Forgejo Actions / search. We perfect it without adding mutation tools.

## A.1 Phase 1 — Correctness & type-validation bugs (HIGH)

| # | Fix | File:Line |
|---|-----|-----------|
| A1.1 | Add `boolean` branch to `checkType` — reject `full:"true"`, `include_patch:1`, etc. with a clear validation error instead of silently defaulting. | `src/mcp/server.ts:94-120` |
| A1.2 | Move enum check out of the string-only branch so `state:42` is rejected (today it bypasses validation and hits the SDK as a number). | `src/mcp/server.ts:102-104` |
| A1.3 | Recurse `checkType` into `type:'object'` args (e.g. `sections` on `get_pull_request`). Add `additionalProperties:false` to `sectionsSchema` and reject unknown keys + wrong inner types. | `src/mcp/tools/pullRequests.ts:76-92`, `src/mcp/server.ts:94-120` |
| A1.4 | `summarizePrDescription` — guard `pr.labels` with `(pr.labels ?? [])` for consistency with sibling summarizers. | `src/mcp/utils/responseFormat.ts:212` |
| A1.5 | `summarizeCommits` — guard `c.commit?.author?.name/date` against null (ghost authors, detached commits). | `src/mcp/utils/responseFormat.ts:258-265` |
| A1.6 | `get_pr_ci_status` and `get_pull_request` ci_status section — null-guard `pr.head?.sha` for deleted-head-repo PRs. | `src/mcp/tools/ciStatus.ts:46`, `src/mcp/tools/pullRequests.ts:323-324` |
| A1.7 | Switch `get_issue` and `get_pull_request` fan-out from `Promise.all` to `Promise.allSettled`. Emit a degraded envelope with `_meta.warnings: string[]` when one branch fails but the primary succeeds. | `src/mcp/tools/issues.ts:148-153`, `src/mcp/tools/pullRequests.ts:254-340` |
| A1.8 | Initialize handshake — honour client's `protocolVersion` (return `min(client, server)`); add optional `instructions` string giving agents high-level guidance. | `src/mcp/server.ts:143-153` |

## A.2 Phase 2 — Resilience & DoS protection (MEDIUM/HIGH)

| # | Fix | File:Line |
|---|-----|-----------|
| A2.1 | **Pagination cap on every list tool.** Expose `page` (default 1) + `limit` (default 30, capped per tool) on all 11 list tools (`list_issues`, `list_issue_comments`, `get_issue_timeline`, `list_pull_requests`, `list_pull_request_files`, `list_pull_request_commits`, `list_pull_request_reviews`, `list_review_comments`, `get_commit_statuses`, `list_releases`, `list_tags`). Internally call the SDK paged methods or fall back to `rawRequest` with `?page=&limit=` to avoid the SDK's `requestAllPages` unbounded fan-out. Stop the "10 000 issues → 200 page requests" DoS. | `src/mcp/tools/{issues,pullRequests,ciStatus,misc}.ts` |
| A2.2 | `get_attachment` — add `AbortSignal.timeout(30_000)` and refuse attachments whose `Content-Length` exceeds 25 MB. Stream the response to base64 (chunked) to avoid 3× peak memory. | `src/mcp/tools/attachments.ts:86-100` |
| A2.3 | `get_file_contents` — add `max_bytes` arg (default 512 KB, max 5 MB); detect non-UTF-8 bytes (NUL byte / replacement-char ratio heuristic) and return `{ is_binary: true, size, mime_guess }` instead of garbled UTF-8. | `src/mcp/tools/misc.ts:109-132` |
| A2.4 | **Transport DoS protection.** Cap `this.buffer` at 16 MB; reject with `PARSE_ERROR` if exceeded. Also enforce a max line length on `parseMessage`. | `src/mcp/transport.ts:160-168` |
| A2.5 | **Transport concurrency bound.** Replace fire-and-forget `void this.handleLine` with a serial chain (or simple N=4 concurrency pool) so 1000 pipelined requests don't fan out into 2000 concurrent HTTP calls. | `src/mcp/transport.ts:166` |
| A2.6 | **Structured HTTP errors.** Catch `ForgejoApiError` in the server's `tools/call` dispatcher; surface `error.data = { http_status, http_status_text, response_body }` so agents can branch on 404 vs 403 vs 429 programmatically. Also recognize 429 + `Retry-After` and retry once after the indicated delay. | `src/mcp/server.ts:212-219` |
| A2.7 | `get_branch_protection` — catch 404 specifically and return `{ protected: false }` envelope instead of `isError:true`. Verify endpoint URL correctness against current Forgejo REST spec; if `/branches/{branch}/protection` is the correct path, switch. | `src/mcp/tools/branchProtection.ts:43-67` |
| A2.8 | `notifications/cancelled` — handle by setting a per-request cancellation token that handlers can opt into for long-running fan-outs. | `src/mcp/server.ts:131-138` |

## A.3 Phase 3 — New read-only tools (workflow/CI + search)

Add **three new tool files** (zero changes to server/transport; append to `ALL_TOOLS`):

### `src/mcp/tools/workflows.ts` (new) — 6 tools
| Tool | SDK / REST | Why |
|---|---|---|
| `list_workflow_runs` | `client.listWorkflowRuns(o,r,{event,branch,actor,status,page,limit})` | Browse recent CI runs (today agents can only see a PR's CI status) |
| `get_workflow_run` | `client.getWorkflowRun(o,r,runId)` | Single-run detail |
| `get_workflow_jobs` | `client.getWorkflowJobs(o,r,runId)` | Per-job status, durations, step names |
| `get_workflow_logs` | `client.getWorkflowLogs(o,r,runNumber,jobRef?)` | Fetch logs (one-shot; same shape as the extension's `actionsTreeProvider`) |
| `list_workflows` | REST `GET /repos/{o}/{r}/actions/workflows` | Enumerate workflow files (today: no way to discover them) |
| `list_workflow_artifacts` | REST `GET /repos/{o}/{r}/actions/runs/{id}/artifacts` | Enumerate artifacts (download URLs) |

### `src/mcp/tools/search.ts` (new) — 3 tools
| Tool | REST | Why |
|---|---|---|
| `search_issues` | `GET /issues/search?type=issues&q=&state=&assignee=&author=&labels=&milestone=&page=&limit=` | Cross-repo issue search (today's `list_issues` is one-repo-only) |
| `search_code` | `GET /code/search?q=&repo=&user=&org=&page=&limit=` | Codebase search — critical for agents navigating unfamiliar repos |
| `search_users` | `GET /users/search?q=&page=&limit=` | Find collaborators / review assignees |

### `src/mcp/tools/repo.ts` (new) — 4 tools
| Tool | REST | Why |
|---|---|---|
| `list_repo_branches` | `GET /repos/{o}/{r}/branches?page=&limit=` | Branch inventory (today: no way) |
| `get_branch` | `GET /repos/{o}/{r}/branches/{branch}` | Single-branch detail incl. protection state |
| `list_repo_commits` | `GET /repos/{o}/{r}/commits?sha=&path=&page=&limit=` | Commit history outside of a PR |
| `compare_commits` | `GET /repos/{o}/{r}/compare/{base}...{head}` | Diff two refs (today: only via PR files) |

All new tools use the same compact-by-default + `full=true` escape hatch pattern, `page`/`limit` pagination, and `Promise.allSettled` for any internal fan-out.

Final tool count: 27 → **40**.

## A.4 Phase 4 — Test coverage & docs

- Extend `__tests__/mcp/tools.test.ts` with: boolean-as-string rejection, enum-as-number rejection, malformed `sections`, fan-out partial-failure envelope, deleted-head-repo PR.
- New `__tests__/mcp/pagination.test.ts` — verify every list tool clamps `page`/`limit` and refuses to fetch more than the cap even when the SDK would.
- New `__tests__/mcp/transport.dos.test.ts` — buffer-size cap, oversized-line rejection, concurrent-pipeline serialization.
- New `__tests__/mcp/structuredErrors.test.ts` — verify `ForgejoApiError` 404/403/429 surfaces `error.data.http_status`; verify 429 backoff happens once.
- New `__tests__/mcp/workflows.test.ts`, `search.test.ts`, `repo.test.ts` — full handler coverage mirroring `misc.test.ts` style.
- New `__tests__/mcp/binary.test.ts` — `get_file_contents` binary detection + size cap, `get_attachment` timeout + size cap.
- Refresh `CODEBASE_INDEX.md` MCP section with the new tools and pagination semantics.
- Refresh tool descriptions in `server.ts` capabilities `instructions` field — concise agent guidance ("Compact by default; pass full=true for raw; pass page/limit to paginate; tools never mutate state").

## A.5 Out-of-scope (per user decision)

- No write/mutation tools (`create_issue`, `merge_pr`, etc.). The server stays read-only.
- No new transport (still hand-rolled stdio JSON-RPC; no `@modelcontextprotocol/sdk` dep).
- No multi-instance support inside the server (single instance per process; switching instances is the agent's responsibility via env vars).

---

# PART B — UI Full-Parity Delivery (owner: subagent)

The audits revealed: ~35–40% feature coverage vs Forgejo web; **a P0 syntax bug at `src/webview/issueDetail/index.js:270` that fully breaks the Issue webview**; ~600 lines of copy-pasted JS/CSS between webviews; no shared base class for providers; many hardcoded colors; no live theme switching; no filter/search/pagination in tree views; no milestones/due dates/file tree/multi-instance/notifications/repo overview/settings.

Executed in four phases. The subagent runs all four sequentially in one task.

## B.1 Phase 1 — P0/P1 correctness fixes (must land first)

| # | Fix | File:Line |
|---|-----|-----------|
| B1.1 | **Delete the stray `}` at `issueDetail/index.js:270`** that closes the activity-timeline click handler early. This single fix unblocks the entire Issue surface (today it's stuck on loading skeleton). | `src/webview/issueDetail/index.js:270` |
| B1.2 | Implement `replyToComment` in issue provider (currently `case 'replyToComment': break;` — does nothing). Use `client.createComment` with proper quote format. | `src/webview/issueDetail/provider.ts:254-255` |
| B1.3 | Unify merge strategies: expose all 5 (`merge / squash / rebase / rebase-merge / fast-forward-only`) in the PR webview merge dialog (today only 3). | `src/webview/prDetail/provider.ts:934-938` |
| B1.4 | Register `vscode.window.onDidChangeActiveColorTheme` listener in each provider; re-broadcast theme to open webviews. | all 5 providers + `extension.ts` |
| B1.5 | Add CSS classes for `in_progress`, `queued`, `waiting`, `blocked` action job statuses (today only `success/failure/running/cancelled/skipped` map to borders). | `src/webview/actionDetail/styles.css:291-310`, `src/webview/actionDetail/index.js:230` |
| B1.6 | Fix `getContrastColor` for 3-char hex (copy the PR variant into the issue variant). | `src/webview/issueDetail/index.js:1114-1125` |
| B1.7 | Add `viewsWelcome` entry for the Releases view (today first-run shows empty panel). | `package.json:371-387` |
| B1.8 | Expose `forgejo.showReleaseDetails` in the release tree context menu (today only "Open in Browser"). | `package.json:292-363` |
| B1.9 | Replace blocking browser `prompt()` / `confirm()` in issue webview with VS Code QuickPick / showInputBox / modal messages. | `src/webview/issueDetail/index.js:415,438,447,448` |
| B1.10 | Make optimistic-edit flows not hide the editor until `actionComplete(success=true)` arrives (today the editor hides on Save even if the API later fails). | `src/webview/prDetail/index.js:690-695` |
| B1.11 | Add `request-id` correlation so double-click Refresh can't race two `_fetchData` calls. | all 5 providers |
| B1.12 | Remove inline `onclick=` from action detail; use event delegation like other webviews. | `src/webview/actionDetail/index.js:230,264` |

## B.2 Phase 2 — Foundation refactor (unblocks everything else)

| # | Deliverable | Notes |
|---|---|---|
| B2.1 | Create `src/webview/shared/baseWebviewProvider.ts` — abstract `BaseDetailWebviewProvider<TData, TMessage>` with panel map, ready/pending pattern, theme + nonce + HTML scaffold, message router, request-id correlation. Cuts ~400 lines. | All 5 providers extend it. |
| B2.2 | Create `src/webview/shared/markdown.js` — single source of truth for the markdown renderer (today ~120 lines copy-pasted in PR + Issue with drift). Update compile script in `package.json:471` to copy it. | Or vendor `marked` (12 KB) — final call: hand-rolled to keep zero-dep story. |
| B2.3 | Create `src/webview/shared/reactions.js`, `theme.js`, `modal.js`, `time.js` — extract the identical helpers from each webview. | Cuts ~300 lines. |
| B2.4 | Create `src/webview/shared/base.css` with `.btn`, `.btn-{primary,secondary,success,danger,sm}`, `.icon-btn`, `.label`, `.status-badge`, `.markdown-body`, `.modal-overlay`, skeleton loaders, scrollbar styling. Each per-webview CSS becomes 50–100 lines. | Cuts ~700 lines. |
| B2.5 | Create `src/webview/shared/tokens.css` with semantic CSS variables replacing every hardcoded hex (`#2da042`, `#f14c4c`, `#ccac00`, `#8957e5`, `#3794ff`, `#616161`). Map each to a `--vscode-*` token with hex fallback so dark/light/HC all work. | Eliminates ~80 hardcoded literals. |
| B2.6 | Create `src/webview/shared/messages.ts` — single `WebviewMessage` discriminated union, per-webview refinements extend it. | Replaces 5 ad-hoc unions. |
| B2.7 | Unify CSP on nonce-based across all 5 webviews (today Issue + Action still use `'unsafe-inline'`). | All providers use the same nonce helper from B2.1. |
| B2.8 | Add a `log()` helper that `postMessage`s webview logs to the extension's output channel (kills 50+ stray `console.log`). | `src/webview/shared/log.js`. |
| B2.9 | Add ESLint config (`browser:true` env) covering `src/webview/**/*.js` + Prettier; this would have caught bug B1.1. | New `.eslintrc.webview.json`. |
| B2.10 | Compile shared assets to `out/webview/shared/` and wire into each provider's `_getHtmlForWebview()` via `<script src="${webview.asWebviewUri(...)}">`. Update `package.json` compile script. | |

## B.3 Phase 3 — Existing-surface completeness

### B.3.1 Tree views (`prTreeProvider`, `issueTreeProvider`, `actionsTreeProvider`, `releaseTreeProvider`)

| # | Feature |
|---|---|
| B3.1.1 | **Filter toolbar** per view: state (open/closed/all), label multi-select, assignee, author (issues), reviewer (PRs), event/status (actions). Uses a new `forgejo.setTreeViewFilter` command + view-title menu items. |
| B3.1.2 | **Search box** per view (uses `search_issues` MCP-side / SDK search). |
| B3.1.3 | **Pagination** — explicit "Load more" tree item at the bottom + auto-load on scroll. Today tree providers rely on SDK default page size and silently truncate large repos. |
| B3.1.4 | **Multi-instance switcher** — view-title dropdown showing current instance + repo, click → quickpick of all configured instances + recently-used owner/repo combos. Critically important for users with Codeberg + self-hosted. |
| B3.1.5 | **Sort** — view-title menu: newest / oldest / recently-updated / most-commented. |
| B3.1.6 | **Loading / empty / error states** already good; just add a tiny "Showing 30 of 247 — Load more" indicator. |

### B.3.2 PR detail webview (`src/webview/prDetail/`)

| # | Feature |
|---|---|
| B3.2.1 | **File tree** in a left rail of the webview (collapsible directories, file-status icons) — replaces the flat tree-view list. Like GitHub's PR file tree. |
| B3.2.2 | **Diff viewer inline** with whitespace toggle / side-by-side / unified / hide-unchanged toggle. Reuses the existing `forgejo-pr:` virtual-doc but rendered inside the webview. |
| B3.2.3 | **Milestones + due date** in the meta grid (today missing). |
| B3.2.4 | **Review queue** — per-reviewer status (approved / requested-changes / pending) next to each name. |
| B3.2.5 | **Description-level reactions** (today only comments have them; Issue has issue-level reactions). |
| B3.2.6 | **Delete branch after merge** checkbox in the merge dialog. |
| B3.2.7 | **Conflicts resolver** — when `mergeable=false`, show a "View conflicts" link that opens each conflicted file with conflict markers. |
| B3.2.8 | **Auto-merge schedule** dropdown (off / merge / squash / rebase) — Forgejo's auto-merge feature. |
| B3.2.9 | **Inline code comments** inside the webview (today only via separate `forgejo-pr:` doc). |
| B3.2.10 | **True threaded replies** — refer to a parent comment_id when creating a reply; render nested. |
| B3.2.11 | **Branch protection status** — show required checks passing/failing, required reviewers, block-merge indicators. |
| B3.2.12 | **Time tracking** — start/stop timer, add manual time, total-spent display. |
| B3.2.13 | **Pin / Lock PR** actions. |
| B3.2.14 | Label/assignee/reviewer inline editors (today: QuickPick only — fine, but add inline `×` removal). |

### B.3.3 Issue detail webview (`src/webview/issueDetail/`)

| # | Feature |
|---|---|
| B3.3.1 | **Milestones + due date** in meta grid. |
| B3.3.2 | **Sub-issues** (blocks / blocked-by) — add/remove relations. |
| B3.3.3 | **Time tracking** UI (start/stop, manual entry, total). |
| B3.3.4 | **Pin issue**, **lock issue** (with reason picker), **transfer issue**. |
| B3.3.5 | **Attachments drag-drop** onto the composer / description editor (uses issue-attachment API). |
| B3.3.6 | **Watch / unwatch**, **subscribe / unsubscribe**. |
| B3.3.7 | **True threaded replies** (same as PR). |
| B3.3.8 | **Inline `×` removal** for labels / assignees (today you have to open QuickPick and deselect). |

### B.3.4 Action detail webview (`src/webview/actionDetail/`)

| # | Feature |
|---|---|
| B3.4.1 | **Log streaming** — poll the logs endpoint every 2 s while a job is `in_progress`; stop on completion. |
| B3.4.2 | **Artifacts panel** — list artifacts with "Save to..." buttons (uses `vscode.window.showSaveDialog`). |
| B3.4.3 | **Annotations panel** — parse annotations from the SDK; group by severity. |
| B3.4.4 | **Re-run failed only** (today: only re-run all). |
| B3.4.5 | **Approve run** button for manual-approval jobs. |
| B3.4.6 | **Workflow dispatch** dialog with input parameters. |
| B3.4.7 | **Run filters** in the actions tree (branch / event / status / actor). |

### B.3.5 Release detail webview (`src/webview/releaseDetail/`)

| # | Feature |
|---|---|
| B3.5.1 | **Edit release** (title + body). |
| B3.5.2 | **Delete release** (modal confirm). |
| B3.5.3 | **Mark as latest / mark as prerelease** toggles. |
| B3.5.4 | **Attach files** via drag-drop or file-picker. |
| B3.5.5 | **In-extension asset download** (today: opens browser URL). |

## B.4 Phase 4 — New top-level surfaces

| # | Surface | Notes |
|---|---|---|
| B4.1 | **Repo Overview webview** — file browser (top-level files), rendered README, license, language stats, latest release teaser, recent activity, contributor count. New command `forgejo.showRepoOverview` + a new tree-view entry at the top of `forgejoExplorer` ("Repository"). |
| B4.2 | **Notifications tree view** — 5th top-level view in `forgejoExplorer`. Lists unread threads with read/unwatch actions. Polls every 60 s. New command `forgejo.refreshNotifications`, `forgejo.markNotificationRead`, `forgejo.markAllNotificationsRead`. |
| B4.3 | **Settings webview** — modal-less panel with tabs: Collaborators, Branch Protection, Webhooks, Deploy Keys. Re-uses branch-protection API already exposed via MCP. New command `forgejo.showRepoSettings`. |
| B4.4 | **Multi-instance indicator** — status-bar item showing current instance + repo; click → instance switcher (ties into B3.1.4). |
| B4.5 | **Forgejo-branded activity bar icon** — replace `$(git-pull-request)` with a real Forgejo SVG (the `forgejo_icon.png` exists at repo root). Convert to SVG and put under new `media/` directory; reference in `package.json` viewsContainers. |
| B4.6 | **Compare/diff builder** — new command `forgejo.compareRefs` opens a QuickPick for base + head, then renders the compare view in a webview. Reuses `compare_commits` from the MCP server. |
| B4.7 | **Milestones list view** — a new tree-view section showing milestones with progress bars (closed/total issues). Click → milestone-scoped issue list. |
| B4.8 | **Activation event tightening** — change `onStartupFinished` to `workspaceContains:.git` + `onCommand:forgejo.*` so the extension doesn't load for users who never use Forgejo. |

## B.5 Out-of-scope (acknowledged but deferred)

- Wiki viewer (low user value; Forgejo wiki is rarely used)
- Projects / kanban board (large effort, low user value)
- Organization / user profile (low priority; "open in browser" remains acceptable)
- Cherry-pick helper (terminal command is fine)

---

# Execution Plan

## Sequencing

1. **ocx executes Part A** (MCP perfection) — phases A.1 → A.4 in order, running `npm run compile` and `npm run test:unit` after each phase to keep the tree green. Build the `.vsix` at the end of Part A and offer to install it.
2. **ocx dispatches a single subagent (general)** to execute Part B (UI full parity) — phases B.1 → B.4 in order. The subagent runs `npm run compile` after each phase. The subagent reports back when the extension builds clean and all P0/P1 bugs are verified fixed.
3. **ocx verifies** by spot-reading the changed files and re-running `npm run compile` + `npm run test:unit`.
4. Final `vsce package` + ask user before installing.

## Verification gates

- After Part A: `npm run test:unit` all green; new tests for pagination / DoS / structured errors / workflows / search / binary all pass; manual `node out/mcp/server.js --debug` smoke test with a mock client confirms initialize + tools/list + one tool from each new module.
- After Part B Phase 1: `npm run compile` clean; opening an Issue detail webview in a real VS Code (via `vscode-test`) no longer hangs on the loading skeleton.
- After Part B Phase 2: line count of `src/webview/**/*.{js,css}` drops by ≥1000; ESLint webview config passes.
- After Part B Phase 3: every "✅ has" item in the feature matrix still works; every "❌ missing" item previously listed is implemented.
- After Part B Phase 4: new commands appear in Command Palette; status-bar instance indicator works; activity bar shows Forgejo icon.
- Final: `vsce package --allow-missing-repository` produces a `.vsix` that installs cleanly into the user's VS Code profile (`code --install-extension ... --force --user-data-dir ~/.config/Code/Profile/paradox`).

## Risk mitigations

- **Subagent context budget**: Phase B is huge; the subagent should batch its work by file (one webview at a time) and check in to ocx via task results between phases.
- **Test flakiness**: All MCP tests are unit-level (no live API). Live tests auto-skip without env vars.
- **Backward compat**: New `page`/`limit` args on list tools default to current behavior (page=1, limit=30) so existing agents calling without those args see no regression.
- **CSP changes**: After B2.7, all webviews are nonce-based. Any external script reference (none today) would break — verify no webview loads remote scripts.

---

## Files to be added (summary)

**Part A — MCP** (7 new files):
- `src/mcp/tools/workflows.ts`
- `src/mcp/tools/search.ts`
- `src/mcp/tools/repo.ts`
- `src/__tests__/mcp/pagination.test.ts`
- `src/__tests__/mcp/transport.dos.test.ts`
- `src/__tests__/mcp/structuredErrors.test.ts`
- `src/__tests__/mcp/{workflows,search,repo,binary}.test.ts`

**Part B — UI** (~15 new files):
- `src/webview/shared/{baseWebviewProvider.ts, base.css, tokens.css, markdown.js, reactions.js, theme.js, modal.js, time.js, log.js, messages.ts}`
- `src/webview/repoOverview/{provider.ts,index.js,styles.css}` (new surface)
- `src/webview/notifications/{provider.ts,index.js,styles.css}` (new surface)
- `src/webview/settings/{provider.ts,index.js,styles.css}` (new surface)
- `src/webview/compare/{provider.ts,index.js,styles.css}` (new surface)
- `media/forgejo-icon.svg` (new Forgejo-branded icon)
- `.eslintrc.webview.json`

## Files to be modified (summary)

**Part A — MCP** (every file under `src/mcp/` is touched):
- `server.ts`, `transport.ts`, `tools/index.ts`, `tools/framework.ts`, `tools/schema.ts`, every `tools/*.ts`, `utils/responseFormat.ts`, `utils/statusDedup.ts`

**Part B — UI** (every file under `src/webview/` and every tree provider is touched):
- All 5 `webview/*/provider.ts`, all 5 `index.js`, all 5 `styles.css`
- All 4 tree providers
- `extension.ts`, `package.json`, `commands/*.ts` (instance switcher, compare builder)
- `.eslintrc.json` (or new `.eslintrc.webview.json`)
- `tsconfig.json` if needed for shared base class

---

End of plan.
