# CLAUDE.md - Guide for AI Agents

This document provides context and guidance for AI agents working on the Forgejo VS Code Extension.

## Project Overview

**Name:** Forgejo VS Code Extension
**Purpose:** Browse Forgejo Pull Requests and Issues directly within VS Code
**Tech Stack:** TypeScript, VS Code Extension API, Node.js built-in fetch
**Language:** TypeScript (compiled to JavaScript)

## Architecture

### Directory Structure

```
forgejo-vscode/
├── src/
│   ├── extension.ts              # Main entry point, registers commands and views
│   ├── api/
│   │   └── forgejoClient.ts      # API client for Forgejo REST API
│   ├── providers/
│   │   ├── prTreeProvider.ts     # TreeDataProvider for Pull Requests
│   │   └── issueTreeProvider.ts  # TreeDataProvider for Issues
│   ├── models/
│   │   ├── pullRequest.ts        # TypeScript interfaces for PR data
│   │   └── issue.ts              # TypeScript interfaces for Issue data
│   └── utils/
│       ├── gitUtils.ts           # Git repository detection and remote parsing
│       └── config.ts             # Configuration management
├── out/                          # Compiled JavaScript (generated)
├── package.json                  # Extension manifest
└── tsconfig.json                 # TypeScript configuration
```

### Key Components

#### 1. Extension Activation (`src/extension.ts`)
- **Activation Event:** `onStartupFinished` - Activates when VS Code starts up
- **Registers:** Tree views, commands, and providers
- **Important:** Never change activation to `onView:forgejoExplorer` as it causes circular dependency

#### 2. Forgejo API Client (`src/api/forgejoClient.ts`)
- Uses Node.js built-in `fetch` (no external dependencies)
- Handles authentication via `Authorization: token <TOKEN>` header
- **Important:** The `/repos/{owner}/{repo}/issues` endpoint returns BOTH issues AND pull requests
  - PRs are filtered out by checking for `pull_request` field in response
- Base URL format: `{instanceUrl}/api/v1/repos/{owner}/{repo}/...`

#### 3. Tree View Providers
- Implement `vscode.TreeDataProvider<T>` interface
- Use `EventEmitter` for `onDidChangeTreeData` to trigger refreshes
- Return message items (error/info) when no data or errors occur
- Group items by state (Open/Closed/Draft/Merged)

#### 4. Git Remote Detection (`src/utils/gitUtils.ts`)
- **Supported URL formats:**
  - HTTPS: `https://git.example.com/owner/repo.git`
  - SSH (scp-style): `git@git.example.com:owner/repo.git`
  - SSH (protocol): `ssh://git@git.example.com/owner/repo.git`
- Extracts: instance URL, owner, and repo name
- Always converts to HTTPS for API requests

#### 5. Configuration (`src/utils/config.ts`)
- **Settings:**
  - `forgejo.instanceUrl` - Forgejo server URL
  - `forgejo.token` - Personal access token
  - `forgejo.autoDetectFromRemote` - Auto-detect from git remote (default: true)
- **Priority:** Manual instanceUrl > Auto-detected from git remote

## Development Workflow

### Building
```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript
npm run watch        # Watch mode for development
```

### Testing

The project uses a **dual-track testing strategy**:
- **Jest** for fast unit tests of pure logic (git parsing, API filtering, configuration)
- **Mocha + @vscode/test-cli** for integration tests requiring VSCode API (tree providers, extension activation)

#### Running Tests

```bash
# Run all tests (unit + integration)
npm test

# Run unit tests only (fast, no VSCode instance required)
npm run test:unit

# Run unit tests in watch mode (for TDD)
npm run test:unit:watch

# Run integration tests (requires VSCode Extension Host)
npm run test:integration

# Generate coverage report
npm run test:unit:coverage
# Then open: coverage/lcov-report/index.html
```

#### Test Structure

```
src/
├── __tests__/           # Unit tests (Jest)
│   ├── fixtures/        # Test data fixtures
│   │   ├── prFiles.ts           # Mock PR file data
│   │   ├── fileContents.ts      # Mock file content responses
│   │   └── prRefs.ts            # Mock PR branch refs
│   ├── providers/
│   │   ├── prDiffContentProvider.test.ts  # 18 tests - Virtual document provider
│   │   └── prTreeProvider.test.ts         # 20 tests - Tree provider logic
│   └── api/
│       └── forgejoClient.test.ts          # 20 tests - API client methods
└── test/                # Integration tests (Mocha)
    ├── index.ts         # Test runner
    └── suite/
        ├── extension.test.ts              # 18 tests - Extension + PR diff commands
        ├── prTreeProvider.test.ts         # 6 tests - PR tree provider
        └── issueTreeProvider.test.ts      # 6 tests - Issue tree provider
```

**Total: 58 unit tests + 30 integration tests = 88 tests**

#### Coverage Targets

Unit test coverage for PR viewing feature (new code):
- **prDiffContentProvider**: 100% statements, 85.71% branches, 100% functions, 100% lines ✅
- **ForgejoClient (new methods)**: Fully tested with 20 test cases ✅
- **prTreeProvider (unit-testable logic)**: File sorting and caching tested ✅

Overall project coverage:
- Target: 70% statements, 65% branches, 70% functions, 70% lines
- Note: Lower overall coverage due to untested legacy code (utils, old providers)
- **New code meets all coverage targets** ✅

#### CI/CD Testing

GitHub Actions workflow (`.github/workflows/test.yml`) runs on every push/PR:
- **3 Operating Systems**: Ubuntu, Windows, macOS
- **2 Node.js versions**: 18.x, 20.x
- **Total**: 6 parallel test jobs

Each job runs:
1. Linting (`npm run lint`)
2. Unit tests with coverage
3. Integration tests

#### Development Workflow with Tests

```bash
# During development (TDD workflow)
npm run test:unit:watch      # Watch mode, instant feedback

# Before committing
npm run lint                 # Check code style
npm run test:unit            # Run unit tests
npm run compile              # Ensure TypeScript compiles

# Before pushing
npm test                     # Run full test suite
```

#### What Gets Tested

**Unit Tests (Jest - No VSCode API):**
- **PR Diff Content Provider** (18 tests):
  - URI parsing and validation
  - Content fetching and caching
  - Error handling
  - Helper function (createPRFileUri)
- **Forgejo API Client** (20 tests):
  - getPullRequestFiles, getFileContents, getPullRequestRefs
  - Base64 decoding
  - URL encoding
  - Authentication
  - Error handling (404, 500, network errors)
- **PR Tree Provider Logic** (20 tests):
  - File sorting algorithm
  - Caching mechanism
  - PRTreeItem creation
  - Icon selection

**Integration Tests (Mocha - With VSCode API):**
- Extension activation and command registration
- PR diff commands (showPrFileDiff, openPrInBrowserFromContext, openPrFileInBrowser)
- Command execution with different file statuses (added, modified, removed, renamed)
- Tree view creation
- Tree provider data fetching
- Error and empty state handling

See `TESTING.md` for detailed testing documentation.

### Manual Testing
```bash
# Press F5 in VS Code to launch Extension Development Host
# Or manually:
vsce package                                    # Create .vsix file
code --install-extension forgejo-vscode-*.vsix  # Install locally
```

### Debugging
1. Open Developer Tools: `Ctrl+Shift+P` → "Developer: Toggle Developer Tools"
2. Check Console tab for `[Forgejo]` prefixed messages
3. All major operations log to console with context

### Packaging
```bash
vsce package  # Creates forgejo-vscode-X.Y.Z.vsix
```

## Common Issues and Solutions

### Issue: Views not appearing
**Cause:** Activation event is wrong
**Solution:** Ensure `activationEvents` in `package.json` is `["onStartupFinished"]`

### Issue: "No Forgejo configuration found"
**Possible causes:**
1. Not in a workspace folder
2. No git repository in workspace
3. No git remote configured
4. Git remote URL format not recognized

**Debug:** Check console for `[Forgejo]` logs showing detection steps

### Issue: PRs appearing in Issues view
**Cause:** Forgejo API returns PRs from `/issues` endpoint
**Solution:** Filter items with `pull_request` field (already implemented in `forgejoClient.ts`)

### Issue: SSH URL not recognized
**Check:** Does `parseRemoteUrl()` handle the format?
**Common formats:** See Git Remote Detection section above

### Issue: API authentication fails
**Check:**
1. Token is set: `forgejo.token` in settings
2. Token has correct permissions (repo scope)
3. Instance URL is correct and accessible


## API Reference

### Forgejo API v1 Endpoints Used

- **List PRs:** `GET /api/v1/repos/{owner}/{repo}/pulls?state={state}&limit=50`
- **List Issues:** `GET /api/v1/repos/{owner}/{repo}/issues?state={state}&limit=50`
  - Returns BOTH issues and PRs - must filter by checking for `pull_request` field
- **PR Details:** `GET /api/v1/repos/{owner}/{repo}/pulls/{number}`
- **Issue Details:** `GET /api/v1/repos/{owner}/{repo}/issues/{number}`

### Authentication
- Header: `Authorization: token <TOKEN>`
- Token obtained from Forgejo Settings → Applications → Generate Token
- Required scope: `repo` (read access)

## Code Patterns and Conventions

### Console Logging
Always prefix logs with `[Forgejo]` for easy filtering:
```typescript
console.log('[Forgejo] Fetching pull requests...');
console.error('[Forgejo] Error:', error);
```

### Error Handling in Providers
```typescript
if (this.error) {
  console.error('[Forgejo] Error:', this.error);
  return [new MessageItem(this.error, true)];
}

if (this.items.length === 0) {
  return [new MessageItem('No items found', false)];
}
```

### TreeDataProvider Pattern
```typescript
type TreeElement = ItemType | GroupType | MessageType;

export class TreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
```

## VS Code Extension Specifics

### Commands
- Command IDs must match `package.json` contributes.commands
- Register in `activate()` function
- Add to `context.subscriptions` for proper cleanup

### Views
- View IDs must match `package.json` contributes.views
- TreeDataProvider must be registered with `vscode.window.createTreeView()`
- Add view to `context.subscriptions`

### Settings
- Define in `package.json` under `contributes.configuration`
- Access via `vscode.workspace.getConfiguration('forgejo')`
- Update via `config.update(key, value, ConfigurationTarget.Global)`

## Testing Checklist

When making changes, verify:
- [ ] All unit tests pass: `npm run test:unit`
- [ ] All integration tests pass: `npm run test:integration`
- [ ] Code coverage meets thresholds: `npm run test:unit:coverage`
- [ ] TypeScript compiles without errors: `npm run compile`
- [ ] Linting passes: `npm run lint`
- [ ] Extension activates (check console for activation message)
- [ ] Views appear in sidebar
- [ ] Git remote detection works for all URL formats
- [ ] PRs and Issues load correctly
- [ ] PRs don't appear in Issues view (critical - verified by tests)
- [ ] Error messages display properly
- [ ] Refresh commands work
- [ ] Click to open in browser works
- [ ] Configuration commands work
- [ ] No runtime errors in console

**Before committing:** Run `npm run lint && npm run test:unit && npm run compile`
**Before pushing:** Run `npm test` (full test suite)

## Useful Commands

```bash
# Development
npm run compile
npm run watch
code --install-extension forgejo-vscode-0.1.0.vsix

# Testing
npm test                     # Run all tests
npm run test:unit            # Unit tests only
npm run test:unit:watch      # Watch mode for TDD
npm run test:unit:coverage   # Generate coverage report
npm run test:integration     # Integration tests only

# Git
git status
git diff
git add <files>
git commit --no-gpg-sign -m "message"

# Testing regex
node -e "const url='ssh://git@example.com/owner/repo.git'; console.log(url.match(/pattern/));"

# Check VS Code logs
# Open: Help → Toggle Developer Tools → Console tab

# View coverage report
open coverage/lcov-report/index.html  # macOS
xdg-open coverage/lcov-report/index.html  # Linux
start coverage/lcov-report/index.html  # Windows
```

## Known Limitations

1. **No pagination:** Currently fetches max 50 items per API call
2. **Read-only:** Cannot create/edit/comment on PRs or Issues
3. **No diff preview:** Cannot view PR diffs in editor
4. **No notifications:** No real-time updates or webhooks
5. **Single remote:** Only detects origin remote
6. **Token storage:** Stored in VS Code settings (not secure storage)

## Future Enhancement Ideas

- Add pagination for large repositories
- Implement PR diff preview in editor
- Add ability to comment on PRs/Issues
- Support multiple git remotes
- Add PR merge functionality
- Implement search and filter
- Add CI/CD status indicators
- Store token in VS Code SecretStorage
- Support for custom Forgejo instances with self-signed certificates

## Git Push and PR Workflow

- **Use the `forgejo` skill** for creating PRs and pushing code. SSH on port 22 is unavailable; the Forgejo skill uses HTTPS API and handles authentication automatically.
- To push a branch: `git push https://codeberg.org/maxking/forgejo-vscode.git <branch>`

## Troubleshooting Tips for Agents

1. **Always check console logs first** - Most issues are visible in logs
2. **Test git remote parsing** - Use Node.js `-e` flag to test regex patterns
3. **Verify API responses** - Use curl or browser to check API endpoint directly
4. **Check TypeScript compilation** - Many issues caught at compile time
5. **Test in Extension Development Host** - F5 provides clean testing environment
6. **Look at existing patterns** - Follow established code patterns in the codebase

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Forgejo API Documentation](https://forgejo.org/docs/latest/user/api-usage/)
- [TreeDataProvider Example](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Extension Samples](https://github.com/microsoft/vscode-extension-samples)

---

**Last Updated:** 2026-02-24
**Agent that last modified:** Claude Opus 4.6
**Testing Infrastructure:** Comprehensive dual-track testing (Jest + Mocha) with 534+ unit tests and 30+ integration tests
