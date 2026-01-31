: 'Hello from Claude Code!'
#!/usr/bin/env node

# Rich PR Detail View - Implementation Plan

## Status: Phase 1 - WebView Infrastructure (In Progress)

## Overview
Implement a rich, web-style PR detail view for the VS Code extension to replace the current plain markdown-based view. The new view will feature an activity timeline, action buttons, and a modern UI similar to GitHub's PR view.

## User Specifications

| Decision | Choice |
|----------|--------|
| View Location | New tab (replaces current markdown view) |
| Comment Display | Flat chronological |
| Inline Diffs | No (separate diff view) |
| Timeline Order | Pure chronological |
| Technology | Vanilla JS/HTML (no build step) |

## UI Mockup

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔗 PR #365: Don't include analytics in download copies          [📋] │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─────────┐                                                          │
│ │ Merged  │  by [👤] maxking into main from automated-pr            │
│ └─────────┘                                                          │
│                                                                      │
│ ┌─────────────┐ ┌──────────┐ ┌─────────────┐ ┌────────────┐          │
│ │  Checkout   │ │ Refresh  │ │ Open in Web │ │ + Comment  │          │
│ └─────────────┘ └──────────┘ └─────────────┘ └────────────┘          │
│                                                                      │
│ ┌───────────────┐ ┌───────────────┐                                  │
│ │ Revert Merge  │ │ Delete Branch │                                  │
│ └───────────────┘ └───────────────┘                                  │
│                                                                      │
│ ──────────────────────────────────────────────────────────────────── │
│ Description                                                          │
│ ──────────────────────────────────────────────────────────────────── │
│ Update DNS records and Caddy configurations using unified services   │
│ .yaml automation                                                      │
│                                                                      │
│ ──────────────────────────────────────────────────────────────────── │
│ Activity (8 events)                                                   │
│ ──────────────────────────────────────────────────────────────────── │
│                                                                      │
│   [👤] maxking opened this pull request Jan 30, 2026                 │
│                                                                      │
│   [👤] maxking commented Jan 31, 2026                                │
│   ┌─────────────────────────────────────────────────────────────┐    │
│   │ I think. To be honest the `no-html` option building the    │    │
│   │ HTML (IIUC) is a tad confusing. This fixes                 │    │
│   │ python/cpython#136194.                                      │    │
│   └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│   [👤] maxking committed d21f85c • "Don't include Plausible in       │
│   download copies"                                                    │
│                                                                      │
│   🔗 maxking linked #136194 Analytics is included in offline         │
│      copies of the python documentation...                            │
│                                                                      │
│   ✅ maxking merged commit 257c105 into main Feb 6, 2026            │
│   ┌───────────────┐                                                   │
│   │    Revert     │                                                   │
│   └───────────────┘                                                   │
│                                                                      │
│   🔒 maxking closed this pull request Feb 6, 2026                    │
│                                                                      │
│   🗑️ maxking deleted the automated-pr branch Feb 6, 2026             │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [Write a comment...                              ] [Submit]        │
└──────────────────────────────────────────────────────────────────────┘
```

## API Endpoints Required

| Data | Endpoint | Method |
|------|----------|--------|
| PR Details | `/repos/{owner}/{repo}/pulls/{index}` | GET |
| Comments | `/repos/{owner}/{repo}/issues/{index}/comments` | GET |
| Reviews | `/repos/{owner}/{repo}/pulls/{index}/reviews` | GET |
| Timeline | `/repos/{owner}/{repo}/issues/{index}/timeline` | GET |
| Commits | `/repos/{owner}/{repo}/pulls/{index}/commits` | GET |
| Add Comment | `/repos/{owner}/{repo}/issues/{index}/comments` | POST |
| Add Review | `/repos/{owner}/{repo}/pulls/{index}/reviews` | POST |
| Merge PR | `/repos/{owner}/{repo}/pulls/{index}/merge` | POST |

## Implementation Phases

### Phase 1: WebView Infrastructure (2-3 days) ✅ IN PROGRESS

**Files to Create:**
1. `src/webview/prDetail/provider.ts` - Main provider class (started, has errors)
2. `src/webview/prDetail/styles.css` - All styling (light/dark theme support)
3. `src/webview/prDetail/index.js` - Vanilla JS for interactivity

**Key Tasks:**
- [x] Create `PRDetailWebviewProvider` class
- [ ] Fix TypeScript errors in provider.ts (remove shebang lines, add missing API methods)
- [ ] Create HTML/CSS/JS template files
- [ ] Register webview in `extension.ts`
- [ ] Add webview contribution to `package.json`
- [ ] Set up message passing protocol between extension and webview

**Current Issues:**
- Provider file has erroneous lines at beginning: `: 'Hello from Claude Code!'` and `#!/usr/bin/env node`
- Missing API methods in `ForgejoClient`: `getIssueComments`, `getPullRequestReviews`, `getPullRequestCommits`, `getIssueTimeline`, `createComment`, `createReview`

### Phase 2: PR Header & Action Bar (2 days)

**Components:**
- **Status Badge:** Color-coded (purple=merged, green=open, red=closed, gray=draft)
- **Title Bar:** PR title + copy button
- **Meta Line:** Author avatar + name → branch info
- **Action Bar:**
  - Checkout (git checkout via VS Code API)
  - Refresh (re-fetch all data)
  - Open in Browser (external link)
  - Add Comment (expandable input)
  - Merge/Revert buttons (conditional on state)

### Phase 3: Activity Timeline (3-4 days)

**Data Sources:**
1. Timeline API - Events (labeled, unlabeled, milestoned, assigned, etc.)
2. Comments API - Regular comments
3. Reviews API - PR reviews (APPROVED, CHANGES_REQUESTED, COMMENTED)
4. Commits API - Commits in PR

**Timeline Items (chronological):**
- Opened event
- Comments with user avatar
- Commits with SHA
- Reviews (approved/changes requested)
- Linked issues
- Labels added/removed
- Merge events
- Close events
- Branch deleted events

**Sorting:** By date (newest first)

### Phase 4: CI Status & Metadata (1-2 days)

- Visual CI checks with status icons
- Labels with colors
- Reviewers list with approval status
- File change count summary

### Phase 5: Interactive Features (2 days)

- **Comment Input:** Expandable textarea with submit/cancel
- **Review Dialog:** Select state (Approve/Request Changes/Comment) + body text
- **Merge Dialog:** Select strategy (merge/rebase/squash) + message
- **Refresh:** Animated loading states

### Phase 6: Polish & Testing (1-2 days)

- VS Code theme integration (light/dark/high-contrast)
- Error handling and retry
- Loading skeletons
- Keyboard shortcuts

## Files Structure

```
src/
├── webview/
│   └── prDetail/
│       ├── provider.ts          # Main provider class
│       ├── styles.css           # Theme-aware CSS
│       ├── index.js             # Vanilla JS entry point
│       └── index.html           # HTML template (or inline in provider)
├── api/
│   └── forgejoClient.ts         # Add 6 new API methods
├── models/
│   └── pullRequest.ts           # Add PRActivity interface
└── extension.ts                 # Register webview + commands
```

## Data Models

### PRActivity Interface
```typescript
export interface PRActivity {
  type: 'comment' | 'review' | 'commit' | 'timeline';
  id: number;
  created_at?: string;
  submitted_at?: string;
  committed_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  state?: string;
  sha?: string;
  message?: string;
  event?: string;
  commit_id?: string;
  html_url?: string;
}
```

### PRDetailViewData Interface
```typescript
export interface PRDetailViewData {
  pr: PullRequest;
  activities: PRActivity[];
  statuses: CommitStatus[];
  owner: string;
  repo: string;
}
```

## VS Code WebView Message Protocol

### Extension → Webview
```typescript
type ExtensionMessage =
  | { type: 'update'; data: PRDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' };
```

### Webview → Extension
```typescript
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'checkout' }
  | { type: 'refresh' }
  | { type: 'merge'; strategy: string; message?: string }
  | { type: 'revert'; commitSha: string }
  | { type: 'addComment'; body: string }
  | { type: 'addReview'; state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'viewCommit'; sha: string }
  | { type: 'viewFile'; filename: string };
```

## API Methods to Add to ForgejoClient

### GET Methods
```typescript
async getIssueComments(owner: string, repo: string, number: number): Promise<any[]>
async getPullRequestReviews(owner: string, repo: string, number: number): Promise<any[]>
async getPullRequestCommits(owner: string, repo: string, number: number): Promise<any[]>
async getIssueTimeline(owner: string, repo: string, number: number): Promise<any[]>
```

### POST Methods
```typescript
async createComment(owner: string, repo: string, number: number, body: string): Promise<any>
async createReview(
  owner: string, 
  repo: string, 
  number: number, 
  state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', 
  body: string
): Promise<any>
```

## Package.json Additions

```json
{
  "contributes": {
    "views": {
      "forgejoExplorer": [
        {
          "type": "webview",
          "id": "forgejo.prDetail",
          "name": "PR Details",
          "when": "forgejo:prDetailVisible"
        }
      ]
    },
    "commands": [
      {
        "command": "forgejo.showPrDetails",
        "title": "Show PR Details",
        "category": "Forgejo"
      }
    ]
  }
}
```

## Key Technical Decisions

1. **No Build Step:** All vanilla JS/CSS, loaded as text strings into webview
2. **No External Dependencies:** Use VS Code's CSS variables for theming, no frameworks
3. **New Tab Location:** Replace markdown document provider with webview panel
4. **Incremental Data Loading:** Load PR details first, then fetch timeline/comments in parallel
5. **Caching:** Cache PR data for 5 minutes, timeline for 2 minutes
6. **Polling:** Auto-refresh every 30 seconds when webview is visible

## CSS Theme Variables

Use VS Code's CSS variables for theming:
```css
:root {
  --vscode-foreground: #cccccc;
  --vscode-editor-background: #1e1e1e;
  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb;
}
```

## Testing Strategy

1. **Unit Tests:** API client methods for new endpoints
2. **Integration Tests:** Webview message passing
3. **Manual Tests:**
   - All PR states (open, closed, merged, draft)
   - Light/dark/high-contrast themes
   - Different activity combinations (comments, reviews, commits)

## Migration Strategy

1. Keep existing `PRDetailsContentProvider` as fallback
2. Add new command `forgejo.showPrDetails` that opens webview
3. Update tree provider to use new command
4. Deprecate old markdown view after webview is stable

## Next Steps

1. Fix provider.ts (remove erroneous lines)
2. Add missing API methods to ForgejoClient
3. Create styles.css
4. Create index.js
5. Update extension.ts to register webview
6. Update package.json

## References

- VS Code WebView API: https://code.visualstudio.com/api/extension-guides/webview
- Forgejo API Docs: See skill at `~/.claude/skills/forgejo/references/api-reference.md`
- Current markdown provider: `src/providers/prDetailsContentProvider.ts`

## Created By
Generated on: 2026-01-31
Mode of work: Direct implementation on current branch
