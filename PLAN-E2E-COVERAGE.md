# Plan: Playwright E2E Test Coverage - Phase 1: Core Features

## Current State

### Existing Playwright Tests (105 tests across 7 files)
| File | Tests | Category |
|------|-------|----------|
| `pr-detail.spec.ts` | 40 | Webview (isolated) |
| `issue-detail.spec.ts` | 28 | Webview (isolated) |
| `markdown.spec.ts` | 27 | Webview (isolated) |
| `extension-ui.spec.ts` | 7 | VS Code e2e |
| `pr-list.spec.ts` | 1 | VS Code e2e (public repo) |
| `pr-list-live.spec.ts` | 2 | VS Code e2e (live instance) |

### Coverage Gaps Addressed in This Phase
1. **Action Detail Webview** - No tests (unlike PR/Issue webviews which have 40+28 tests)
2. **Issue List (live)** - No live tests for the issue tree view
3. **Actions List (live)** - No live tests for the actions tree view
4. **PR/Issue interactions (live)** - No live tests for comments, state changes, creation

### Limitations & Out-of-Scope (Phase 2)
The following features **cannot be E2E tested** with the current Playwright-VSCode harness because `evaluateInVSCode` cannot interact with VS Code's modal UI elements (`showInputBox`, `showQuickPick`, `showWarningMessage`):

- **`forgejo.addInstance`** - Requires 3 sequential `showInputBox` prompts
- **`forgejo.manageInstances`** - Multi-level `showQuickPick` flow
- **`forgejo.selectRemote`** - Uses `showQuickPick`
- **`forgejo.configureInstanceUrl`** / **`forgejo.setAuthToken`** (legacy) - Uses `showInputBox`
- **`forgejo.createPullRequest`** / **`forgejo.createIssue`** (via VS Code command) - Uses sequential `showInputBox` prompts
- **`forgejo.mergePr`** / **`forgejo.closePr`** (via VS Code command) - Requires modal dialog confirmation
- **File status notifications** - `showFileStatusNotifications` setting requires opening PR diff files
- **Legacy config migration** - Internal `migrateToMultiInstance()` flow

These commands need harness enhancements (input box/quick pick/modal automation) to be testable in Phase 2.

**Workaround for interaction tests**: Team C will bypass VS Code command UI and call the `ForgejoClient` API directly within `evaluateInVSCode`. This validates the API integration works end-to-end against the real Forgejo instance, even though it doesn't test the VS Code command UI layer.

## Implementation Plan

### Team A: Action Detail Webview Tests (isolated browser tests)

**File: `src/test/e2e/action-detail.spec.ts`**

Follows the exact same pattern as `pr-detail.spec.ts` and `issue-detail.spec.ts` - loads webview HTML in a Playwright browser page with mock data, no VS Code required.

**Tests to write (~30 tests):**
1. **Initialization** (3 tests)
   - Shows loading state on initial load
   - Sends 'ready' message to extension on init
   - Transitions from loading to content on update

2. **Header & Metadata** (6 tests)
   - Displays workflow name
   - Displays run number
   - Displays commit info (short SHA + message)
   - Displays branch name
   - Displays event type (formatted: "push", "pull request", "manual")
   - Displays duration

3. **Health Summary** (5 tests)
   - Shows SUCCESS badge for successful run
   - Shows FAILURE badge for failed run
   - Shows RUNNING badge for in-progress run
   - Shows CANCELLED badge
   - Shows correct health stats ("2 of 3 jobs passed • 1 failed")

4. **Jobs List** (6 tests)
   - Renders job items with status icons
   - Shows job names and durations
   - Shows "No jobs found" when empty
   - Shows correct job count
   - Expandable steps within jobs
   - View Logs button posts message

5. **Failures Section** (3 tests)
   - Hidden when no failures
   - Shows failed steps with job → step format
   - Shows multiple failures

6. **Action Buttons** (4 tests)
   - Refresh button posts 'refresh' message
   - Re-run button posts 'rerun' message
   - Open in Browser button posts 'openInBrowser' message
   - Retry button on error posts 'refresh' message

7. **Error State** (3 tests)
   - Shows error message
   - Hides content on error
   - Retry button visible

**Infrastructure needed:**
- Add `loadActionDetail()` method to `WebviewHarness`
- Add `sendActionUpdate()` method to `WebviewHarness`
- Add `ActionDetailData` type and `createMockActionData()` factory to webview-harness

### Team B: Live VS Code E2E Tests - Issue & Actions Lists

**File: `src/test/e2e-vscode/issue-list-live.spec.ts`**

Follows the exact same pattern as `pr-list-live.spec.ts`:

**Tests to write (~4 tests):**
1. Should display issue groups (Open/Closed with counts)
2. Should display the test issue entry ("Test Issue")
3. Should refresh issues when refresh command is executed
4. Should not show PRs in the issues list (critical regression test)

**File: `src/test/e2e-vscode/actions-list-live.spec.ts`**

**Tests to write (~2 tests):**
1. Should display actions view (empty state graceful handling)
2. Should refresh actions when refresh command is executed

Note: The test repo has no CI workflows, so Actions view shows empty/message state. This validates the view doesn't crash and handles empty state gracefully.

### Team C: Live VS Code E2E Tests - API Interactions

**Important: Test isolation strategy**

Each test creates its own test data via the Forgejo API at the start and does not depend on artifacts from the setup script or from previous tests. This prevents state pollution between tests.

**File: `src/test/e2e-vscode/pr-interactions-live.spec.ts`**

Tests bypass VS Code command UI and call the ForgejoClient API directly within `evaluateInVSCode` to test the full integration path.

**Tests to write (~5 tests):**
1. Should add a comment to a PR via API and verify via API
2. Should close a PR via API and verify tree view updates (creates its own PR first)
3. Should create a PR via API and verify it appears in the tree view
4. Should refresh PR list and see updated data
5. Should handle diagnostics command without error when instance is configured

**File: `src/test/e2e-vscode/issue-interactions-live.spec.ts`**

**Tests to write (~5 tests):**
1. Should add a comment to an issue via API and verify via API
2. Should close an issue via API and verify tree view updates (creates its own issue first)
3. Should reopen a closed issue via API and verify tree view updates
4. Should create an issue via API and verify it appears in the tree view
5. Should list issues and verify PRs are not included

### Setup Script Changes

The `setup-forgejo-test.sh` script needs additions for interaction tests:

```bash
# After existing PR creation:
echo "Creating second feature branch for interaction tests..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/branches" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"new_branch_name":"feature-branch-2","old_branch_name":"main"}' >/dev/null 2>&1 || echo "Branch may already exist, continuing..."

echo "Adding test file on second feature branch..."
CONTENT2=$(echo -n "Hello World 2" | base64)
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/contents/test2.txt" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"add test file 2\",\"content\":\"${CONTENT2}\",\"branch\":\"feature-branch-2\"}" >/dev/null 2>&1 || echo "File may already exist, continuing..."

echo "Creating second issue for interaction tests..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/issues" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Issue 2","body":"Second test issue for interaction tests"}' >/dev/null 2>&1 || echo "Issue may already exist, continuing..."
```

### Summary of New Tests

| Team | File | New Tests |
|------|------|-----------|
| A | `action-detail.spec.ts` | ~30 |
| B | `issue-list-live.spec.ts` | ~4 |
| B | `actions-list-live.spec.ts` | ~2 |
| C | `pr-interactions-live.spec.ts` | ~5 |
| C | `issue-interactions-live.spec.ts` | ~5 |
| **Total** | | **~46 new tests** |

### Final Test Count
- Existing: 105 tests
- New: ~46 tests
- **Total: ~151 Playwright e2e tests**

### Feature Coverage After Implementation

| Feature | Before | After |
|---------|--------|-------|
| PR detail webview | 40 tests | 40 tests (already complete) |
| Issue detail webview | 28 tests | 28 tests (already complete) |
| Action detail webview | 0 tests | ~30 tests |
| Markdown/XSS | 27 tests | 27 tests (already complete) |
| Extension activation | 7 tests | 7 tests (already complete) |
| PR list (live) | 2 tests | 2 tests (already complete) |
| Issue list (live) | 0 tests | ~4 tests |
| Actions list (live) | 0 tests | ~2 tests |
| PR interactions (live) | 0 tests | ~5 tests |
| Issue interactions (live) | 0 tests | ~5 tests |
| PR list (public repo) | 1 test | 1 test (already complete) |

### Conventions
- All new tests follow existing patterns exactly (same fixtures, same harness methods)
- Live tests skip gracefully when env vars are not set (`test.skip(!shouldRun, ...)`)
- Live tests use 60s timeout like existing live tests
- Webview tests use the existing `WebviewHarness` pattern
- All test files use existing `getTreeRowLabels()` helper pattern for tree view scraping
- **Test isolation**: Each interaction test creates its own test data; no cross-test dependencies
- **Serial execution**: Live config uses `fullyParallel: false` and `workers: 1`
