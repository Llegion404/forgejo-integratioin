# Plan: Review All PR Changes

## Goal

Replace the one-file-at-a-time diff flow with a GitHub-style "Files changed" page showing all PR diffs on one scrollable webview. Files start collapsed and expand individually.

## Approach

Separate webview panel (not a tab in PR Detail), triggered from a new tree item at the top of each PR's file list.

## Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `src/webview/review/provider.ts` | Webview panel provider -- creates panel, fetches PR files with patches, sends data, handles messages |
| 2 | `src/webview/review/index.js` | Client-side JS -- renders file list with expand/collapse, parses diff patches into colored line views |
| 3 | `src/webview/review/styles.css` | Styling -- GitHub-like diff colors (green/red backgrounds), file headers, line numbers |

## Files to Modify

| # | File | Change |
|---|------|--------|
| 4 | `src/commands/registry.ts` | Add `'forgejo.reviewPrChanges'` command signature |
| 5 | `src/providers/prTreeProvider.ts` | Add `PRReviewAllItem` class (tree item "Review all changes (N files)" at top of file list), show in `getPRFiles()` |
| 6 | `src/extension.ts` | Import & instantiate `ReviewProvider`, register `reviewPrChanges` command |
| 7 | `package.json` | Declare command in `contributes.commands` |

## Implementation Steps

### Step 1: Create `PRReviewAllItem` -- tree item in `prTreeProvider.ts`
- New class extending `vscode.TreeItem` with label `"Review all changes (N files)"`
- `contextValue = 'prReviewAll'`
- `iconPath = new vscode.ThemeIcon('book')`
- `command` pointing to `forgejo.reviewPrChanges` with PR context arguments
- Inserted as the first child of each `PRTreeItem` in `getPRFiles()`

### Step 2: Create `ReviewProvider` -- `src/webview/review/provider.ts`
- Follows existing webview pattern (`PRDetailWebviewProvider` etc.)
- `static readonly viewType = 'forgejo.review'`
- `show()` method: creates webview panel, fetches `client.getPullRequestFiles(owner, repo, number)`, sends `PullRequestFile[]` (with `patch` field) to webview
- `_getHtmlForWebview()`: generates HTML with CSP nonce, loads `index.js` + `styles.css` via webview URIs
- Data sent to webview: `{ type: 'update', pr: { number, title }, files: PullRequestFile[] }`

### Step 3: Create webview frontend -- `index.js` + `styles.css`
- **Header:** PR title, file count, +/- totals
- **File list:** Each file shown as expandable section
  - Header row: status badge (A/M/D/R colored), filename, +N -N stats, expand/collapse chevron
  - Body: syntax-colored diff when expanded
  - Default: all collapsed
- **Diff rendering:** Parse the `patch` string (unified diff format)
  - Split by `@@` hunk headers
  - Lines starting with `+` -> green background, `-` -> red background
  - Other lines -> context (no color)
  - Render line numbers (old/new) on the left
- **"Viewed" checkbox** on each file header (cosmetic, like GitHub)

### Step 4: Register command -- `extension.ts` & `registry.ts` & `package.json`
- Command: `forgejo.reviewPrChanges`
- Arguments: `(pr: PullRequestListItem, owner: string, repo: string)`
- Handler calls `reviewProvider.show(owner, repo, pr)`

### Step 5: Build & test
- `npm run compile` to verify
- Install extension to test in VS Code

## Data Flow

```
User clicks "Review all changes (N files)" in PR tree
  -> forgejo.reviewPrChanges(pr, owner, repo)
  -> ReviewProvider.show(owner, repo, pr)
    -> ForgejoClient.getPullRequestFiles(owner, repo, pr.number)
    -> PRView created, HTML set
    -> Webview posts { type: 'ready' }
    -> Provider sends { type: 'update', pr, files }
    -> index.js renders file list with collapsed diffs
    -> User clicks file -> expand -> diff renders inline
```

## Edge Cases

- **PR with 0 files:** Show "No files changed" message
- **Binary files:** The `patch` field will be absent/null -- show "Binary file not shown" placeholder
- **Large diffs (many files/huge patches):** Webview performance should be fine since files start collapsed; patch parsing is lightweight
- **File statuses:** Handles added, modified, changed, removed, renamed -- all have `patch` fields from the API
