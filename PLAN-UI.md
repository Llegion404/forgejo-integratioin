# Forgejo VS Code Extension — UI Remaster Plan

**Supersedes:** `PLAN.md` Part B (whose foundation + new-surface phases shipped, but whose consolidation + feature-completeness phases did not).
**Scope decided with user:** Fix bugs + consolidate first → native VS Code visual feel → all surfaces (8 webviews + 6 tree views + status bar) → incremental, shippable milestones.
**Audits behind this plan:** four explore-agent reports covering every webview, tree provider, and the shared layer (findings referenced as `file:line` throughout).

---

## Current state (post-audit)

**Shipped & healthy:** shared layer (`shared/{baseWebviewProvider.ts, base.css, tokens.css, util.js, markdown.js, theme.js, reactions.js, log.js, messages.ts}`); new surfaces (`repoOverview`, `settings`, `compare`, `review`, `releaseDetail`, `milestoneTreeProvider`, `notificationTreeProvider`, `instanceStatusBar`); MCP Part A.

**The core problem:** the shared layer is only ~40% adopted. The four older webviews (`prDetail`, `issueDetail`, `actionDetail`, `releaseDetail`) plus `review` still ship **inline copies** of `renderMarkdown` / `escapeHtml` / `formatTimeAgo` / `renderReactions` / `applyTheme`, plus hardcoded hex/rgba colors and emoji icons. The new surfaces adopted the shared modules but introduced their own bugs. Net: drift, divergence, and a stack of real user-facing defects.

**Real bugs confirmed by audit (highest-severity, with refs):**
- Reaction **remove** toggle is dead — `reacted-by-me` class never applied (`prDetail/index.js:738,885`; `issueDetail/index.js:252-264`; CSS `:467`).
- IssueDetail's **Add-label / Add-assignee buttons are invisible** (`.icon-btn-small` defined twice; second wins with `opacity:0`) (`issueDetail/styles.css:259` vs `:493`).
- **Closed issues render in merged-purple** `#8957e5` instead of red (`issueDetail/styles.css:110`).
- ActionDetail **durations are fabricated** — `stopped_at` always null, so finished runs show an ever-growing timer (`actionDetail/provider.ts:135`; `index.js:401`).
- ActionDetail **ignores `conclusion`** — `timed_out` / `neutral` / `action_required` runs render as UNKNOWN (`index.js:233-255`).
- ActionDetail **"View Logs" hidden when job has 0 steps** (`index.js:301-304,322-324`).
- RepoOverview → ReleaseDetail **navigation is broken** (malformed `tag_name:''` payload) (`repoOverview/provider.ts:180`).
- ReleaseDetail **`refresh` message has no handler** (`provider.ts:125-160`; sent by `index.js:37`).
- ReleaseDetail **`markLatest` is a misnomer** — just clears prerelease (`provider.ts:154-156`).
- PRDetail **review-state badges unstyled** (class mismatch: JS emits `.changes`/`.review`, CSS defines `.changes_requested`/`.commented`) (`index.js:680-681`; `styles.css:485-486`).
- PRDetail **Checkout button shown for merged/closed**; **Merge clickable on conflicts** (`index.js:596-618`).
- Inline `onerror` on avatars is **CSP-blocked** (broken-image glyph shown) (`issueDetail/index.js:970`; same in `prDetail`).
- Three different **theme-application conventions**, two of which are no-ops (`ForgejoTheme.apply` never called; `releaseDetail` uses `.theme-*`; `review` uses `data-theme`).
- Issue/Release tree providers render with **empty `owner`/`repo`** on first cached paint until background sync completes.
- Notification (60s) and status-bar (30s) **poll unconditionally** regardless of view visibility.

---

## Execution model

- Each phase is independently shippable: `npm run compile` + `npm run test:unit` + `npm run lint` + `npm run lint:webview` green, then offer to install (`AGENTS.md` flow).
- One webview touched per phase where possible — minimizes review surface and merge risk.
- Every phase that changes `index.js`/`styles.css` for a webview must end with that webview re-opened in a real VS Code to visually verify (via `vscode-test` or the user).
- **Decision points** (flagged inline) are surfaced to the user before implementation, not decided unilaterally.

---

# Track 1 — Shared-layer completion (enables all later consolidation)

> Small foundational phase. No UX change on its own. Must land before Track 2 so each webview is touched **once** (consolidate + adopt codicons + tokenize together) rather than three times.

## Phase 1.1 — Codicon system in webviews
**Why first:** "Native VS Code feel" was chosen; codicons replace emoji. Doing this in `base.css` once means each webview's consolidation phase also gets codicons for free.

- Ship the codicon `ttf` under `media/codicon.ttf` (from `node_modules/...` or vendor the official file). Wire `@font-face` in `base.css` and a `.codicon.codicon-<name>` class system mirroring VS Code's codicon lib.
- Extend CSP `font-src` to allow the webview source (in `_buildCsp`, `baseWebviewProvider.ts:59-66`).
- Add a tiny `ForgejoIcon` helper in `util.js`: `icon(name)` → `<span class="codicon codicon-${name}">` so JS renderers don't hand-build spans.
- **Decision point:** vendor codicon.ttf (license = MIT, CC-BY for icons — compatible) vs render SVGs inline. Recommend vendoring the font (matches VS Code native, smallest payload, themeable via `currentColor`).

## Phase 1.2 — Markdown renderer feature gaps
`shared/markdown.js` is XSS-safe and good, but missing pieces Forgejo content leans on heavily:

- **`@mentions`** → `<a class="mention" data-username="…">` (click posts `openUserProfile`).
- **`#123` / `owner/repo#123` issue/PR refs** → `<a class="issue-ref" data-owner data-repo data-number>` (click posts `openIssue`/`openPR`).
- **Autolinks** for bare `https://…` URLs.
- **Relative/same-origin URLs** — `sanitizeUrl` (`markdown.js:12-16`) currently drops them; accept relative paths when an instance base URL is supplied via `ForgejoMarkdown.configure({ instanceUrl })` and rewrite to absolute, tagged with `data-internal` so clicks stay in-extension.
- **Nested lists** (currently flattened, `markdown.js:133-146`).
- **Syntax-highlighting hook** — keep `class="language-X"` emission, add an optional `ForgejoMarkdown.setHighlight(lang, code)` registry so Phase 8.2 can plug in a highlighter without touching markdown.js again.

## Phase 1.3 — Shared runtime helpers + components
- Add to `util.js`: `fileStatusGlyph(status)` (kills the compare `'+'`/`'M'` vs review `'A'`/`'M'` divergence), `formatBytes(n)` (currently local in `releaseDetail/index.js:201`).
- Add shared **component CSS** to `base.css` so webviews stop re-rolling: `.avatar` (with `.avatar-img` + broken-image fallback via JS listener, not inline `onerror`), `.timeline`/`.timeline-item`/`.timeline-marker`, `.comment-card`, `.tabs`/`.tab`/`.tab-panel`, `.file-row`/`.file-status` modifiers, `.diff-line`/`.diff-line-num`/`.diff-line.add/.del/.ctx`, `.empty-state`.
- **Token gaps:** fix `.btn-success`/`.btn-danger` hardcoded `color:#fff` (`base.css:47,50`) → `--forgejo-button-*-fg`; make `--forgejo-*-bg` translucent variants HC-aware (`tokens.css:16-20`); retire unused `--forgejo-muted` alias.
- **Unify skeleton animation** on `forgejo-skeleton-shimmer` (`base.css`); delete the local `shimmer`/`pulse` keyframes in `releaseDetail/styles.css:18` and `review/styles.css`.
- **Standardize reaction vocabulary** on `.reaction-pill` / `.add-reaction-btn` (what `shared/reactions.js:36-38` already emits). Migrate `issueDetail`'s `.reaction-badge`/`.reaction-add-btn` and reconcile `prDetail`'s local renderer.

## Phase 1.4 — Enforce the base-provider contract
- Make `getHtmlForWebview(webview)` a `protected abstract` on `BaseDetailWebviewProvider` (today it's only described in the class docstring, `baseWebviewProvider.ts:8-18`, not enforced).
- Move shared message cases (`log`, `showConfirm`, `showInputBox`, `ready`, `refresh`, `openInBrowser`, `openUserProfile`, `openInBrowserFromUrl`) into a base `_handleBaseMessage` router that subclasses' switches call as a fallthrough. Kills repeated boilerplate and the dead-`replyToComment`-handler pattern.
- Bake the **`lastRequestId` race-guard** into the base as a `_runFetch(key, fn)` helper (currently re-implemented correctly in `settings`/`repoOverview`/`compare` but missing in `review`/`releaseDetail`).
- Add `_sharedAssetsHtml` script tags **with nonces** (`baseWebviewProvider.ts:100-108`) — currently they load only because the CSP also whitelists the host source; fragile.
- Register `onDidChangeActiveColorTheme` listener **inside the base** on first panel open, so forgetting to call `registerThemeListener()` (a real gap today) is impossible.

## Phase 1.5 — Tests for the shared runtime layer
The shared JS IIFEs (`markdown.js`, `reactions.js`, `util.js`, `theme.js`, `log.js`) have **no unit tests**. Add jest tests (run in jsdom) covering:
- markdown: each GFM feature, mention/ref/autolink, URL sanitization (javascript:/data: dropped), nested lists, table alignment.
- reactions: aggregation, `reacted-by-me` class when current user in list, emoji map.
- util: contrast color (3/6-digit hex), formatTimeAgo boundaries, formatDuration, fileStatusGlyph.

**Gate:** Phase 1 ends green; no behavior change visible to users yet.

---

# Track 2 — Consolidation + bug fixes (user's #1 priority)

> Per-webview. Order: lowest-risk-cleanest first to establish the pattern, then the heavyweights. Each webview: delete inline dups → adopt shared modules → fix its bug list → replace emoji with codicons → tokenize colors. One webview per phase = one review.

## Phase 2.1 — `releaseDetail` (smallest, worst duplication — fast win)
- Delete local `renderMarkdown`/`escapeHtml`/`formatTimeAgo` (`index.js:185-266`); call `ForgejoMarkdown.render` / `ForgejoUtil.*`.
- **Fix `refresh` handler** (add `case 'refresh'` in `provider.ts:125-160` switch).
- **Fix `markLatest` semantics** — Decision point: either (a) rename button to "Unset prerelease" (matches what it does), or (b) implement true "mark latest" if Forgejo API supports it (it computes `is_latest` server-side, so (a) is correct). Recommend (a).
- Delete `applyTheme` no-op (`index.js:268-270`); call `ForgejoTheme.apply`.
- Token-ize `.status-badge.{release,prerelease,draft}` hardcoded hexes (`styles.css:42-44`) → `--forgejo-success/-warning/-muted`.
- Strip ~40 lines duplicated from `base.css` (`.btn`, `.icon-btn`, `.loading`, `.skeleton`, `.markdown-body`).
- Replace `📋`/`⬇`/`⚠️`/`✓` with codicons.
- Add Save-button loading state on edit (`index.js:67-72` double-submit guard).
- Wire user-link click → `openUserProfile` (`index.js:96-101` currently just `preventDefault`s).

## Phase 2.2 — `review`
- Delete `applyTheme` no-op (`index.js:22-24`); call `ForgejoTheme.apply`.
- Token-ize `.status-badge.status-{added,modified,removed,renamed}` rgba (`styles.css:100-104`) → `--forgejo-success-bg`/`-warning-bg`/`-danger-bg`/`-info-bg`.
- Strip duplicated reset/body/`.btn`/`.loading`/`.skeleton`/`.error` (~30 lines); rely on `base.css`.
- Add `lastRequestId` race-guard to `_fetchData` (`provider.ts:101-140`).
- **Fix `openFile` fake-object hack** (`provider.ts:177-190`) — pass through the real `PullRequestFile` from the files list rather than a stub with `status:'modified'` and zero counts.
- **Fix diff line-number column** (`review/styles.css:143-145`): render two-column old/new gutter (not single col), widen from 20px/9px font so 3-digit line numbers don't clip.
- Unify `STATUS_LETTERS` (`index.js:6`, missing `copied`) with `ForgejoUtil.fileStatusGlyph` from Phase 1.3.
- Replace `▶` chevron with codicon `chevron-right`.

## Phase 2.3 — `repoOverview`
- **Fix `openRelease` navigation** (`provider.ts:180`) — fetch the full release by id/tag before dispatching `forgejo.showReleaseDetails`, or change the command contract to accept `{owner, repo, releaseId}` and have `releaseDetail` fetch. Decision point: recommend the latter (single source of truth).
- Pass `instanceUrl` into `ForgejoMarkdown.configure(...)` before rendering README so relative links resolve.
- Replace `⚠️` error emoji with codicon; replace the language-bar stat emojis (`⭐`/`📤`/`⚠`/`📖`/`🌿`/`📁`/`📄`/`👤`, `index.js:52-56,110,155`) with codicons.
- Optional: pull the hardcoded language palette (`index.js:83`) into a shared `FORGEJO_LANG_PALETTE` constant (acceptable as fixed categorical colors; document why they don't theme).

## Phase 2.4 — `actionDetail`
- Delete local `escapeHtml`/`formatDuration`/`applyTheme` dups (`index.js:425-442`); call `ForgejoUtil`/`ForgejoTheme`. **Kill the `applyTheme` `className=''` bug** (`index.js:434`) that wipes body classes.
- **Honor `conclusion`** in `getOverallStatus` (`index.js:233-255`): map `timed_out`→failure-ish, `neutral`/`action_required`→neutral; surface in `getStatusIcon`.
- **Honest durations:** Decision point — the run-details API has "incompatible IDs" (`provider.ts:139`). Either (a) fetch via raw `GET /repos/{o}/{r}/actions/runs/{run_number}` to get true `started_at`/`stopped_at`, or (b) display "finished" with no duration when `stopped_at` unknown instead of a fabricated growing timer. Recommend (a); fall back to (b) on failure.
- **Fix "View Logs" hidden when 0 steps** (`index.js:301-304`) — render the button unconditionally per job.
- **Wire `showConfirm`** for Cancel/Re-run (`provider.ts` — the plumbing exists, never connected).
- **Surface job-fetch errors** instead of silent `[]` (`provider.ts:149-152`) — show a warning banner "Jobs failed to load: …".
- Replace `✅❌⏳⛔⏭⭘` status emojis with codicons (`pass`/`error`/`sync~spin`/`circle-slash`/`debug-step-over`/`circle-outline`).
- Token-ize `.health-badge.*` hardcoded hexes (`styles.css:91-121`) and failures-section reds (`:368,398-399,406,424,433`) → `--forgejo-*`.
- **Delete HC var overrides** (`styles.css:457-463`) — they fight the real theme; add proper HC rules at the right layer.
- Remove dead `blocked` status branches (`index.js:218`, `styles.css:314-316`).
- Adopt `ForgejoLog` (kill 24 `console.log`).

## Phase 2.5 — `issueDetail` (largest after PR)
- Delete the entire local `renderMarkdown`/`processInline`/`buildTable`/`parseTableRow`/`processBlockquoteContent`/`sanitizeUrl`/`escapeHtml`/`formatTimeAgo`/`renderReactions` block (`index.js:750-995`, ~250 lines); call shared modules.
- **Fix `.icon-btn-small` double-definition** (`styles.css:259` vs `:493`) — split into `.add-chip-btn` (header add-label/add-assignee) and `.row-action-btn` (comment hover actions). Restores visibility of Add-label/Add-assignee.
- **Fix closed-issue color** (`styles.css:110`) `#8957e5` → `--forgejo-danger` (red). Adopt shared `.status-badge.closed` from `base.css`.
- **Implement reaction un-toggle** — add `reacted-by-me` class when current user's login is in the reaction's user list; wire `removeReaction`/`removeIssueReaction` send paths (`index.js:252-264`).
- **Switch label/assignee mgmt to QuickPick** (parity with PR's `manageLabels`/`manageAssignees`, `prDetail/provider.ts:678-751`); add `manageMilestone`.
- **Collect lock reason** (`index.js:126` → `provider.ts:296,550`).
- Fix avatar inline `onerror` (`index.js:970`) → use shared `.avatar` component from Phase 1.3.
- Replace `📋✓✕➕💬✏️🗑️🔄😊` and reaction emojis with codicons.
- Delete dead `replyToComment` message type + `_replyToComment` handler (`provider.ts:22,361-379`) — the reply button intentionally pre-fills the box.
- Token-ize hardcoded `rgba(0,0,0,…)` shadows (`styles.css:373,482`).
- **Decision point:** drop the `body.vscode-high-contrast` overrides (`styles.css:518-524`) that hardcode `#000`/`#fff` — rely on real HC tokens. (Recommend yes.)

## Phase 2.6 — `prDetail` (biggest, most-used)
- Delete local `renderMarkdown`/`processInline`/`buildTable`/`parseTableRow`/`processBlockquoteContent`/`sanitizeUrl`/`escapeHtml`/`renderReactions`/`formatTimeAgo` (`index.js:880-996`) — call shared modules. (PR-level reactions already use `ForgejoReactions.render` at `:564`; comment-level still local at `:885` — reconcile.)
- **Fix review-state class mismatch** (`index.js:680-681` emits `.changes`/`.review`; `styles.css:485-486` defines `.changes_requested`/`.commented`) — align names; also `.timeline-marker.approve` (singular, `styles.css:397`) vs JS `.approved`.
- **Fix reaction un-toggle** — same fix as issueDetail (`reacted-by-me` never applied, `index.js:738,885-906`).
- **Hide Checkout for merged/closed** PRs; **disable Merge when `pr.mergeable===false`** (`index.js:596-618`).
- **Wire markdown link clicks** in description/comments → host `openInBrowserFromUrl` (`index.js:304-310` only covers `<img>`).
- **Persist title edit on blur** with Esc-to-cancel (`index.js:216-221` currently discards on blur).
- Fix CSS syntax error `px 8px;` (`styles.css:117`).
- Delete dead CSS: `.label-pill .label-remove`, `.assignee-chip .chip-remove`, `.reviewer-chip .chip-remove`, `.timeline-author`, `.timeline-marker.approve` (`styles.css:198,240,402,397`).
- Token-ize hardcoded rgba shadows/overlays (`styles.css:525,548,562,601`).
- Replace emoji (`✅❌⚠️⏳↻🔗←` + reaction emojis + picker) with codicons; make emoji-picker options keyboard-focusable.
- Adopt `ForgejoLog`.
- **Decision point:** keep `base ← head` branch-arrow direction or flip to Forgejo's `head → base`? Recommend Forgejo's direction for familiarity.

**Phase 2 gate:** every webview re-opened in VS Code; reaction toggle works both directions; issue Add buttons visible; action durations honest; releaseDetail refresh works; repoOverview release-link opens the right release. `npm run compile` + `npm run test:unit` + `npm run lint:webview` green.

---

# Track 3 — Native VS Code visual sweep (verify + fill gaps)

> Most codicon/tokenization work happens inside Track 2 per-webview. This phase is the cross-cutting verification + the surfaces not covered by Track 2.

## Phase 3.1 — Cross-webview visual audit & cleanup
- Grep-verify **zero emoji icons** remain in any `index.js`/`provider.ts` HTML; zero hardcoded `#hex`/`rgba(` in any `styles.css` (excluding the language palette, documented).
- Grep-verify every webview calls `ForgejoTheme.apply` (no local `applyTheme`).
- Grep-verify every webview calls `ForgejoMarkdown.render` / `ForgejoUtil.*` / `ForgejoReactions.render` / `ForgejoLog.*` (no local dups).
- Confirm `base.css` is the single source for skeleton/buttons/badges/markdown/modal (no per-webview duplicates).
- Confirm `.reaction-pill`/`.add-reaction-btn` is the only reaction vocabulary.

## Phase 3.2 — Activity bar, view icons, empty states
- **Activity bar icon** (`media/forgejo-icon.svg`) — Decision point: (a) keep the orange Forgejo brand gradient (current), or (b) rework to use `currentColor` so it adapts to the user's theme like other VS Code activity-bar icons. Native-feel argues for (b); brand recognition argues for (a). Recommend (b) with the brand orange as the default via a `--forgejo-brand` token, theme-overridable.
- Add **per-view `icon`** to the six views in `package.json:56-83` (PR/Issue/Action/Release/Milestone/Notification) — currently all icon-less. Use codicons (`git-pull-request`, `issues`, `beaker`/`play`, `tag`, `milestone`, `bell`).
- Add the **Forgejo brand mark** to empty-state/welcome cards and webview headers (currently only on the activity bar) — wire `forgejo-icon.svg` through `_sharedAssetsHtml` so webviews can `<img>` it.
- Fix the `view/title` **`group: navigation@4` collision** in PRs (`package.json:339-347`).

## Phase 3.3 — High-contrast correctness pass
- Remove every `body.vscode-high-contrast { --vscode-*: … }` override (issue `styles.css:518-524`, action `styles.css:457-463`) — these fight the user's real HC theme.
- Verify translucent `*-bg` tokens render acceptably under HC (add solid HC fallbacks where needed).
- Add `@media (forced-colors: active)` rules for status-colored borders that rely on alpha hexes.

**Gate:** manual visual check in light + dark + high-contrast themes across all 8 webviews.

---

# Track 4 — Tree-view polish

> The 6 tree views already use codicons correctly (the strong surface). Focus is consistency + missing affordances + bugs.

## Phase 4.1 — Correctness bugs
- **Fix stale `owner`/`repo` on cached first paint** (`issueTreeProvider.ts:91-92,190`; `releaseTreeProvider.ts:80-81,155`) — read config fresh at click-time the way `prTreeProvider.ts:294` does, or block click commands until sync completes.
- **Fix aggregate-icon false-neutral** (`actionsTreeProvider.ts:108-115`) — all-success-plus-one-skipped should show `pass`, not `circle-outline`.
- **Fix release tooltip/command mismatch** (`releaseTreeProvider.ts:18` says "open in browser" but command opens webview).
- **Gate polling by view visibility** (`notificationTreeProvider.ts:65` 60s; `instanceStatusBar.ts:26` 30s) — use `TreeView.onDidChangeVisibility` / `window.onDidChangeWindowState` to pause when hidden.
- **Bound the `prDiffContentProvider` cache** (`prDiffContentProvider.ts:33`) — add LRU/TTL; fix the empty-string-as-miss bug at `:57`.
- **Fix `prDetailsContentProvider` cache key** to include head SHA (`prDetailsContentProvider.ts:37-41,76`) so force-pushes don't serve 5-min-stale CI status.
- Replace hardcoded **emoji CI icons** (`🟣⚪🔴🟢✅❌⏳⚠️❓`, `prDetailsContentProvider.ts:188-226`) with codicons for consistency with the tree providers.
- Delete dead `PRLoadingItem` (`prTreeProvider.ts:103-109`).

## Phase 4.2 — Parity affordances
- Add **sort + state filter to Actions and Releases** (parity with PR/Issue) — `actionsTreeProvider.ts` and `releaseTreeProvider.ts` currently have neither; `package.json` view-title menus `:379-402` lack the buttons.
- Add **`switchInstance`** to Actions/Releases/Notifications view-title menus (`package.json` — only PR/Issue/Milestones have it today).
- Add **ThemeColor to Release icons** (`releaseTreeProvider.ts:23-27`) — currently plain `ThemeIcon`s, flatter than the other 3 providers.
- Add **context menus for group items** (`prGroup`/`issueGroup`/`releaseGroup`) — `package.json:424-505` wires nothing for them today.
- Add **"Load more" pagination** item to all 4 list views (PR/Issue/Action/Release) — today they silently truncate at the SDK default page size (`PLAN.md` B3.1.3, never done).
- Normalize the **separator glyph** inconsistency: actions use `·` (U+00B7), PR/Issue use `•` (U+2022) — pick one.

## Phase 4.3 — Welcome content + group/empty states
- Verify all six `viewsWelcome` cards (`package.json:513-544`) render correctly post-icon changes; refresh wording/codicons to match Phase 3.2.

**Gate:** every tree view exercised: filter/sort applied, pagination loads page 2, group right-click works, instance switch reflects in status bar, no API calls fire while a view is hidden.

---

# Track 5 — "Full Forgejo experience" feature gaps

> The completeness work `PLAN.md` B.3 targeted but was largely skipped. Ordered by user value. Each is its own shippable milestone.

## Phase 5.1 — Files-Changed tab in PR detail (highest value)
The single biggest gap vs Forgejo web — PRDetail has **no diff section at all** today (only timeline events). The `review` webview already implements a diff renderer.

- **Decision point:** absorb `review` into `prDetail` as a "Files Changed" tab (recommended — one PR surface), or keep them separate and just add a tab-link. Recommend absorbing: add a `.tabs` header to prDetail with Conversation / Commits / Files-Changed tabs; reuse `review/index.js`'s `renderDiff` (now using shared `.diff-*` CSS from Phase 1.3).
- Add `+N −M` totals header; per-file expand; status icons.
- Per-file "Open in diff editor" via the existing `forgejo.showPrFileDiff` command.

## Phase 5.2 — Reaction un-toggle everywhere (consistency)
- Already in Track 2 per-webview, but call out: every reactions surface (PR desc, PR comment, issue desc, issue comment) must support add **and** remove with a `reacted-by-me` highlight. Verify after Track 2.

## Phase 5.3 — Action logs: ANSI + streaming + artifacts
- **ANSI color rendering** — add a shared `ForgejoAnsi.toHtml(logText)` helper (strip SGR codes → `<span>` spans); render streamed logs in a `<pre class="log-stream">` using `--vscode-terminal-*` ANSI color tokens so it matches the integrated terminal.
- **Live streaming** — poll the logs endpoint every 2s while job `status` is active (the 2s poller skeleton already exists at `actionDetail/index.js:215-231`); stop on terminal status; auto-scroll-to-bottom with a "jump to latest" control.
- **Artifacts panel** — `GET /repos/{o}/{r}/actions/runs/{id}/artifacts`; list with size + "Save to…" (`vscode.window.showSaveDialog`).
- **Re-run failed jobs only** — `POST /actions/runs/{id}/rerun` with `only-failed` flag.
- Move the log document from external untitled-file (`provider.ts:310-315`) into an inline `<pre>` panel inside the webview.

## Phase 5.4 — Inline code review comments in the PR webview
- Render review comments inline on diff lines in the Files-Changed tab (Phase 5.1); reply/edit/resolve threads via `forgejo-pr:`-style flow but in-webview.
- Surface pending-review status (the `pendingReviewManager` singleton) in the webview header.

## Phase 5.5 — Markdown editor improvements
- **Preview tab** on the comment composer + description editor (Write/Preview toggle) — render via `ForgejoMarkdown.render`.
- **Drag-drop attachments** onto composer/description (issue-attachment API).
- Optional: `@`/`#` autocomplete quick-picks in the textarea.

## Phase 5.6 — Smaller parity items (batch)
- PR: milestones + due date in meta grid; review queue per-reviewer status; delete-branch-after-merge checkbox; auto-merge schedule dropdown; conflicts resolver link; branch-protection status; pin/lock; time-tracking.
- Issue: sub-issues (blocks/blocked-by); pin/transfer; watch/subscribe.
- Action: annotations panel; approve-run for manual-approval jobs; workflow-dispatch dialog with inputs.
- Release: attach files (drag-drop/file-picker); in-extension asset download.
- True threaded replies (nested comments, refer parent `comment_id`) — PR + Issue.

**Gate per phase:** feature works end-to-end against a real Forgejo instance (live test or manual); `npm run compile` + unit tests green.

---

# Verification gates (summary)

| After | Must pass |
|---|---|
| Track 1 (Phase 1.x) | `compile` + `test:unit` (incl. new shared-layer tests) + `lint:webview` green; no UX change |
| Each Phase in Track 2 | `compile` + `test:unit` + `lint` + `lint:webview`; that webview re-opened in VS Code; its specific bugs verified fixed |
| Track 3 | visual check across light/dark/HC; grep proofs for zero-emoji/zero-hardcoded-color/zero-local-applyTheme |
| Track 4 | each tree view's filter/sort/pagination/visibility-gating verified; status bar reflects instance |
| Track 5 (each) | end-to-end against real Forgejo; offer to install |
| Final | `vsce package --allow-missing-repository` → install into the paradox profile per `AGENTS.md` |

---

# Decision points to confirm before each track

1. **Codicon vendoring** (Phase 1.1) — vendor `codicon.ttf` (MIT/CC-BY, compatible) vs inline SVG. Recommend vendor.
2. **`markLatest` semantics** (Phase 2.1) — rename to "Unset prerelease" (Forgejo computes `is_latest` server-side). Recommend rename.
3. **`openRelease` contract** (Phase 2.3) — change command to accept `{owner, repo, releaseId}` and have releaseDetail fetch. Recommend yes.
4. **Action durations** (Phase 2.4) — fetch true stop-time via raw `/actions/runs/{run_number}` vs show "finished" without duration. Recommend fetch with fallback.
5. **IssueDetail HC overrides** (Phase 2.5) — drop the `#000`/`#fff` hardcodes. Recommend yes.
6. **PR branch-arrow direction** (Phase 2.6) — flip to Forgejo's `head → base`. Recommend yes.
7. **Activity bar icon** (Phase 3.2) — `currentColor` (theme-adaptive) vs fixed brand orange. Recommend `currentColor` with brand-orange default token.
8. **Absorb `review` into `prDetail`** (Phase 5.1) — one PR surface with tabs vs separate webviews. Recommend absorb.

---

# Out of scope (deferred)

- Wiki viewer, Projects/kanban, org/user profile webviews (low value per `PLAN.md` B.5).
- Side-by-side diff toggle inside the webview (the native VS Code diff editor via `forgejo-pr:` remains the side-by-side path).
- Migrating `shared/helpers.ts` (Node-side) onto the webview modules — it's test-only and intentionally divergent; just fix its misleading docstring (`helpers.ts:8`) and its unsanitized link regex (`:38`) so it can't accidentally leak into a webview.
- `CODEBASE_INDEX.md` line-count staleness (`:66-69`, `:67`) — update as a final housekeeping step.
