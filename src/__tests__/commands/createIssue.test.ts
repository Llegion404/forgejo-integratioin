import * as vscode from 'vscode';
import { createIssueCommand } from '../../commands/createIssue';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

const mockIssue = {
  number: 42,
  title: 'Test Issue',
  html_url: 'https://git.example.com/test-owner/test-repo/issues/42',
};

describe('createIssueCommand', () => {
  let mockIssueTreeProvider: { refresh: jest.Mock };
  let mockCreateIssue: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIssueTreeProvider = { refresh: jest.fn() };
    mockCreateIssue = jest.fn().mockResolvedValue(mockIssue);
    MockForgejoClient.mockImplementation(() => ({ createIssue: mockCreateIssue } as any));
  });

  it('shows error and returns early when config is null', async () => {
    mockGetForgejoConfig.mockResolvedValue(null);

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Forgejo configuration not found. Please configure an instance first.'
    );
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error and returns early when token is missing', async () => {
    mockGetForgejoConfig.mockResolvedValue({ ...mockConfig, token: undefined } as any);

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'A Forgejo token is required to create issues. Please configure your token first.'
    );
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('returns early when user cancels title input', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('returns early when user cancels body input', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Issue Title')
      .mockResolvedValueOnce(undefined);

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('proceeds with API call when body is empty string (coerced to undefined)', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Issue Title')
      .mockResolvedValueOnce('');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createIssueCommand(mockIssueTreeProvider as any);

    // Empty string body should NOT trigger early return; API called with body: undefined
    expect(mockCreateIssue).toHaveBeenCalledWith('test-owner', 'test-repo', 'My Issue Title', undefined);
    expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
  });

  it('creates issue, refreshes tree, and offers Open in Browser on success', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Issue Title')
      .mockResolvedValueOnce('My issue description');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Open in Browser');

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(mockCreateIssue).toHaveBeenCalledWith(
      'test-owner', 'test-repo', 'My Issue Title', 'My issue description'
    );
    expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Issue #42 created successfully!',
      'Open in Browser'
    );
    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      vscode.Uri.parse(mockIssue.html_url)
    );
  });

  it('shows error message when API call fails', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Issue Title')
      .mockResolvedValueOnce('description');
    mockCreateIssue.mockRejectedValueOnce(new Error('Network error'));

    await createIssueCommand(mockIssueTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to create issue: Network error'
    );
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
  });
});
