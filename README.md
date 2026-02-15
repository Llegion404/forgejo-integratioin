# Forgejo VS Code Extension

> Browse Forgejo Pull Requests and Issues directly within VS Code.

<!-- TODO: Add screenshot here -->
<!-- ![Screenshot](docs/images/screenshot.png) -->

## Quick Start

1. **Install** the extension from the [VS Code Marketplace](#installation)
2. **Open** a folder containing a Forgejo/Codeberg git repository
3. **Click** the Forgejo icon in the Activity Bar (sidebar)
4. **Done!** Your PRs and Issues appear automatically

For private repositories, [add a Personal Access Token](#setting-up-authentication).

## Features

- **Pull Requests**: View, browse files, see diffs, merge, and close PRs
- **Issues**: View issues with full details and comments
- **Multi-Instance Support**: Connect to multiple Forgejo servers simultaneously
- **Auto-Detection**: Automatically detects Forgejo instance from your git remote
- **PR File Diffs**: View file changes directly in VS Code's diff editor
- **Grouping**: PRs grouped by state (Open, Draft, Merged, Closed)
- **Browser Integration**: Click to open PRs/Issues in your browser

### Supported Platforms

- [Codeberg](https://codeberg.org)
- Self-hosted Forgejo instances
- Gitea instances (compatible API)

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac)
3. Search for "Forgejo Integration"
4. Click **Install**

### From Open VSX (for VSCodium)

1. Open VSCodium
2. Go to Extensions
3. Search for "Forgejo Integration"
4. Click **Install**

### From VSIX File

Download the `.vsix` file from the [Releases](https://github.com/maxking/forgejo-vscode/releases) page, then:

```bash
code --install-extension forgejo-vscode-*.vsix
```

Or in VS Code: Extensions view → `...` menu → "Install from VSIX..."

## Setting Up Authentication

Authentication is **optional for public repositories** but required for private repos.

### Step 1: Create a Personal Access Token (PAT)

#### On Codeberg

1. Go to [codeberg.org/user/settings/applications](https://codeberg.org/user/settings/applications)
2. Under "Manage Access Tokens", click **Generate New Token**
3. Enter a name (e.g., "VS Code Extension")
4. Select permissions:
   - `read:repository` - View PRs and Issues (minimum required)
   - `write:repository` - Merge PRs, close Issues (optional)
5. Click **Generate Token**
6. **Copy the token immediately** - you won't see it again!

#### On Self-Hosted Forgejo

1. Go to `https://your-forgejo-instance.com/user/settings/applications`
2. Follow the same steps as Codeberg above

### Step 2: Add the Token to VS Code

**Option A: Using Command Palette (Recommended)**

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type **"Forgejo: Add Instance"**
3. Enter your instance URL (e.g., `https://codeberg.org`)
4. Enter a friendly name (e.g., "Codeberg")
5. Paste your token when prompted
6. Click **Test Connection** to verify

**Option B: Using Settings UI**

1. Open Settings: `Ctrl+,` (Windows/Linux) or `Cmd+,` (Mac)
2. Search for "forgejo"
3. Click **Edit in settings.json** under "Forgejo: Instances"
4. Add your instance configuration

### Multiple Instances

You can connect to multiple Forgejo servers:

1. Run **"Forgejo: Manage Instances"** from Command Palette
2. Add additional instances with their own tokens
3. The extension will match repositories to the correct instance automatically

## Usage

### Viewing Pull Requests

1. Click the **Forgejo icon** in the Activity Bar
2. Expand the **Pull Requests** section
3. Click a PR to see its files
4. Click a file to view the diff

### PR Actions

Right-click on a PR for options:
- **View PR Details** - See full description and comments
- **Open PR in Browser** - Open on Forgejo website
- **Merge PR** - Merge with options (merge commit, squash, rebase)
- **Close PR** - Close without merging

### Viewing Issues

1. Expand the **Issues** section in the Forgejo view
2. Click an issue to see details and comments
3. Right-click to open in browser

### Commands

Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Forgejo":

| Command | Description |
|---------|-------------|
| Forgejo: Add Instance | Add a new Forgejo server |
| Forgejo: Manage Instances | View and edit configured servers |
| Forgejo: Refresh Pull Requests | Reload PR list |
| Forgejo: Refresh Issues | Reload Issue list |
| Forgejo: Show Diagnostics | Debug connection issues |
| Forgejo: Show Output Channel | View extension logs |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `forgejo.autoDetectFromRemote` | `true` | Auto-detect instance from git remote |
| `forgejo.debug` | `false` | Enable debug logging |
| `forgejo.showFileStatusNotifications` | `true` | Show notifications for added/deleted files |

## Troubleshooting

### "No Forgejo configuration found"

- Make sure you're in a workspace with a git repository
- Check that you have a git remote configured (`git remote -v`)
- Try running **"Forgejo: Add Instance"** to manually configure

### PRs or Issues not loading

1. Run **"Forgejo: Show Diagnostics"** to check connection status
2. Verify your token is valid and has correct permissions
3. Check the Output channel: **"Forgejo: Show Output Channel"**

### Authentication errors

1. Regenerate your token on the Forgejo website
2. Run **"Forgejo: Manage Instances"** to update the token
3. Make sure the token has `read:repository` scope

### Git remote not detected

The extension looks for the `origin` remote. Supported URL formats:
- HTTPS: `https://codeberg.org/owner/repo.git`
- SSH: `git@codeberg.org:owner/repo.git`
- SSH protocol: `ssh://git@codeberg.org/owner/repo.git`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Quick Development Setup

```bash
git clone https://github.com/maxking/forgejo-vscode.git
cd forgejo-vscode
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only (fast)
npm run lint          # Check code style
```

## Changelog

### v0.3.0

#### Features
- **Inline PR commenting** via Comment Controller API (#58)
- **Clickable CI statuses** — open target URL from PR detail view (#54)
- **3-level Actions tree view** — Run → Job → Step hierarchy (#52)

#### Fixes
- Show descriptive event text in issue detail timeline (#56)
- Show correct icons for files with `changed` status (#60)
- Deduplicate CI statuses by context in PR detail view (#53)
- Show commit title instead of "Run #N" in Actions tree

#### Chores
- Upgrade ESLint to strict-type-checked + stylistic rules (#59)
- Extract `requestWithBody` helper and add proper return types (#57)
- Add `.worktree/` to `.vscodeignore`

### v0.2.0

- Initial release with PR and Issue browsing, file diffs, multi-instance support, and auto-detection from git remotes.

## Acknowledgments

- [Forgejo](https://forgejo.org) - The self-hosted Git service this extension supports
- [Codeberg](https://codeberg.org) - For hosting Forgejo and being a great community
- [VS Code Extension API](https://code.visualstudio.com/api) - For making this possible
