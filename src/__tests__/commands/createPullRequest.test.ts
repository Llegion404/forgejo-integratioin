import * as vscode from 'vscode';
import { branchNameToTitle, createPullRequestCommand } from '../../commands/createPullRequest';

jest.mock('child_process');
jest.mock('../../utils/config');
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

import { execSync } from 'child_process';
import { getForgejoConfig } from '../../utils/config';
import { ForgejoClient } from '../../api/forgejoClient';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

// ---------------------------------------------------------------------------
// branchNameToTitle — pure function
// ---------------------------------------------------------------------------

describe('branchNameToTitle', () => {
  it('replaces hyphens with spaces and capitalizes', () => {
    expect(branchNameToTitle('feat-my-branch')).toBe('Feat my branch');
  });

  it('replaces underscores with spaces and capitalizes', () => {
    expect(branchNameToTitle('fix_bug_123')).toBe('Fix bug 123');
  });

  it('replaces mixed hyphens and underscores', () => {
    expect(branchNameToTitle('feat-my_branch')).toBe('Feat my branch');
  });

  it('capitalizes a single-word branch name', () => {
    expect(branchNameToTitle('main')).toBe('Main');
  });

  it('returns empty string unchanged', () => {
    expect(branchNameToTitle('')).toBe('');
  });

  it('preserves path separators while replacing hyphens (documents behavior)', () => {
    // The slash is not replaced; only - and _ are
    expect(branchNameToTitle('feature/my-branch')).toBe('Feature/my branch');
  });
});

// ---------------------------------------------------------------------------
// createPullRequestCommand — command handler
// ---------------------------------------------------------------------------

describe('createPullRequestCommand', () => {
  let mockPrTreeProvider: { refresh: jest.Mock };
  let mockCreatePullRequest: jest.Mock;

  const baseConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'testowner',
    repo: 'testrepo',
    token: 'test-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrTreeProvider = { refresh: jest.fn() };

    // Default: workspace folder is open
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/workspace' } }];

    // Default: git commands succeed
    mockExecSync
      .mockReturnValueOnce('feat-my-branch\n' as any)  // git rev-parse
      .mockReturnValueOnce('refs/remotes/origin/main\n' as any); // symbolic-ref

    // Default: getForgejoConfig returns a valid config with token
    mockGetForgejoConfig.mockResolvedValue(baseConfig as any);

    // Default: ForgejoClient.createPullRequest succeeds
    mockCreatePullRequest = jest.fn().mockResolvedValue({
      number: 42,
      title: 'Feat my branch',
      html_url: 'https://git.example.com/testowner/testrepo/pulls/42',
    });
    MockForgejoClient.prototype.createPullRequest = mockCreatePullRequest;
  });

  afterEach(() => {
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  // --- Early-exit: config problems ---

  it('shows error and returns when config is null', async () => {
    mockGetForgejoConfig.mockResolvedValue(null);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('configuration not found')
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('shows error and returns when token is missing', async () => {
    mockGetForgejoConfig.mockResolvedValue({ ...baseConfig, token: '' } as any);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('token is required')
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('shows error and returns when no workspace folder is open', async () => {
    (vscode.workspace as any).workspaceFolders = undefined;

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder open.');
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  // --- Early-exit: git failures ---

  it('shows error and returns when branch detection (git rev-parse) throws', async () => {
    mockExecSync.mockReset();
    mockExecSync.mockImplementationOnce(() => { throw new Error('not a git repo'); });

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Could not determine the current git branch.'
    );
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('falls back to "main" when default-branch detection (symbolic-ref) throws', async () => {
    mockExecSync.mockReset();
    mockExecSync
      .mockReturnValueOnce('feat-my-branch\n' as any)
      .mockImplementationOnce(() => { throw new Error('no origin/HEAD'); });

    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Feat my branch')  // title
      .mockResolvedValueOnce('')                // body (empty is valid)
      .mockResolvedValueOnce('main');           // base branch

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      'testowner', 'testrepo', 'Feat my branch', 'feat-my-branch', 'main', undefined
    );
  });

  // --- Early-exit: user cancellation ---

  it('returns early (no API call) when user cancels title input', async () => {
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockPrTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('returns early (no API call) when user clears title to empty string', async () => {
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('');

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('returns early (no API call) when user cancels body input (Escape → undefined)', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce(undefined); // Escape on body = undefined

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('proceeds (does NOT cancel) when user submits empty string body', async () => {
    // empty string ≠ undefined; empty body is valid (user hit Enter with no text)
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce('')    // empty body is valid
      .mockResolvedValueOnce('main');

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      'testowner', 'testrepo', 'My PR title', 'feat-my-branch', 'main', undefined
    );
  });

  it('returns early (no API call) when user cancels base-branch input', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(undefined); // cancel base branch

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  // --- Success path ---

  it('calls createPullRequest and refreshes tree on success', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce('Some description')
      .mockResolvedValueOnce('main');

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

    await createPullRequestCommand(mockPrTreeProvider);

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      'testowner', 'testrepo', 'My PR title', 'feat-my-branch', 'main', 'Some description'
    );
    expect(mockPrTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'PR #42 created successfully!',
      'Open in Browser'
    );
  });

  it('opens PR in browser when user clicks "Open in Browser"', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('main');

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Open in Browser');

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.env.openExternal).toHaveBeenCalled();
  });

  // --- API error path ---

  it('shows error message when API call throws', async () => {
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My PR title')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('main');

    mockCreatePullRequest.mockRejectedValue(new Error('API connection failed'));

    await createPullRequestCommand(mockPrTreeProvider);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to create pull request: API connection failed'
    );
    expect(mockPrTreeProvider.refresh).not.toHaveBeenCalled();
  });
});
