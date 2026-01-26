# Forgejo VS Code Extension

Browse Forgejo Pull Requests and Issues directly within VS Code.

## Features

- View pull requests from your Forgejo repository
- View issues from your Forgejo repository
- Auto-detect Forgejo instance from git remote
- Support for multiple Forgejo instances (Codeberg, self-hosted, etc.)
- Group PRs by state (Open, Draft, Merged, Closed)
- Group Issues by state (Open, Closed)
- Click to open PRs/Issues in browser
- Refresh data with a single click

## Requirements

- VS Code 1.85.0 or higher
- A Forgejo repository (local or remote)
- Forgejo personal access token (optional, for private repositories)

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Press F5 to launch the Extension Development Host

## Configuration

### Auto-detect from Git Remote (Recommended)

If you have a git repository with a Forgejo remote, the extension will automatically detect:
- The Forgejo instance URL
- The repository owner
- The repository name

### Manual Configuration

Open VS Code Settings and configure:

- `forgejo.instanceUrl`: Your Forgejo instance URL (e.g., `https://codeberg.org`)
- `forgejo.token`: Your personal access token for authentication
- `forgejo.autoDetectFromRemote`: Enable/disable auto-detection from git remote (default: `true`)

### Getting a Personal Access Token

1. Go to your Forgejo instance
2. Navigate to Settings → Applications
3. Create a new access token with `repo` scope
4. Copy the token and set it in VS Code settings

## Usage

### View Pull Requests and Issues

1. Open a workspace with a Forgejo git repository
2. Click the Forgejo icon in the Activity Bar
3. View Pull Requests and Issues in the sidebar

### Refresh Data

Click the refresh icon in the view title bar or use:
- `Forgejo: Refresh Pull Requests`
- `Forgejo: Refresh Issues`

### Configure Settings

Use the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):
- `Forgejo: Configure Instance URL`
- `Forgejo: Set Authentication Token`

### Open in Browser

Click on any PR or Issue to open it in your default browser.

## Supported Forgejo Instances

- Codeberg.org
- Self-hosted Forgejo instances
- Gitea instances (compatible API)

## Remote URL Formats

The extension supports both HTTPS and SSH remote formats:

- HTTPS: `https://codeberg.org/owner/repo.git`
- SSH: `git@codeberg.org:owner/repo.git`

## Troubleshooting

### No PRs or Issues showing up

1. Make sure you have a git repository with a Forgejo remote
2. Check that `forgejo.instanceUrl` is configured correctly
3. For private repositories, ensure you have set a valid access token
4. Try refreshing the view manually

### Authentication errors

1. Verify your access token is valid
2. Check that the token has the correct permissions (repo scope)
3. Try regenerating the token

### Git remote not detected

1. Ensure you have a remote named `origin` configured
2. Check the remote URL format is supported
3. Manually configure `forgejo.instanceUrl` if needed

## Development

### Project Structure

```
forgejo-vscode/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── api/
│   │   └── forgejoClient.ts      # Forgejo API client
│   ├── providers/
│   │   ├── prTreeProvider.ts     # Pull Requests tree view
│   │   └── issueTreeProvider.ts  # Issues tree view
│   ├── models/
│   │   ├── pullRequest.ts        # PR data model
│   │   └── issue.ts              # Issue data model
│   └── utils/
│       ├── gitUtils.ts           # Git repository detection
│       └── config.ts             # Configuration management
└── package.json                  # Extension manifest
```

### Building

```bash
npm install
npm run compile
```

### Running

Press F5 in VS Code to launch the Extension Development Host.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
