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

### Option 1: Install from VS Code Marketplace (Coming Soon)

Once published, you'll be able to install directly from the VS Code Marketplace:

1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Forgejo Integration"
4. Click Install

### Option 2: Install from VSIX File

If you have a `.vsix` package file:

1. Download the `.vsix` file
2. Open VS Code
3. Go to the Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
4. Click the `...` menu at the top of the Extensions view
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

### Option 3: Build and Install from Source

For development or testing the latest version:

```bash
# Clone the repository
git clone https://github.com/forgejo/forgejo-vscode.git
cd forgejo-vscode

# Install dependencies
npm install

# Build the extension
npm run compile

# Install vsce globally
npm install -g @vscode/vsce

# Package the extension
vsce package

# Install the extension in VS Code
code --install-extension forgejo-vscode-0.1.0.vsix
```

Alternatively, to run the extension in development mode:

```bash
# Press F5 in VS Code to launch the Extension Development Host
```

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

### Packaging & Installing

To build a `.vsix` file for installation in VS Code:

```bash
# Install the packaging tool (globally)
npm install -g @vscode/vsce

# Build the .vsix file
vsce package

# This creates forgejo-vscode-0.1.0.vsix (version from package.json)
```

To install the `.vsix` file in VS Code:

**Option 1: Command Line**
```bash
code --install-extension forgejo-vscode-0.1.0.vsix
```

**Option 2: VS Code UI**
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
3. Click the "..." menu at the top of the Extensions view
4. Select "Install from VSIX..."
5. Choose the `forgejo-vscode-0.1.0.vsix` file

**Option 3: Command Palette**
1. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type "Extensions: Install from VSIX..."
3. Select the `.vsix` file

After installation, reload VS Code to activate the extension.

### Running for Development

Press F5 in VS Code to launch the Extension Development Host.

### Testing

The project uses a dual-track testing strategy:
- **Jest** for fast unit tests of pure logic (git parsing, API filtering, configuration)
- **Mocha + @vscode/test-cli** for integration tests requiring VSCode API

#### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only (fast)
npm run test:unit

# Run unit tests in watch mode
npm run test:unit:watch

# Run integration tests
npm run test:integration

# Check coverage
npm run test:unit:coverage
```

#### Test Structure

- **Unit tests** (`src/__tests__/`): Test pure logic without VSCode instance (Jest)
- **Integration tests** (`src/test/`): Test VSCode API integration (Mocha + @vscode/test-cli)

#### Coverage

The project maintains the following coverage targets:
- Git utilities: 95%+
- API client: 85%+
- Configuration: 80%+
- Overall: 70%+

View the coverage report by running `npm run test:unit:coverage` and opening `coverage/lcov-report/index.html`.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Before Submitting a PR

All pull requests must:
- Pass linting: `npm run lint`
- Pass all tests: `npm test`
- Maintain or improve code coverage (70%+ overall)
- Include tests for new features or bug fixes

### Development Workflow

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
