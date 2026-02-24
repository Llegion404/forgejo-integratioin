import * as vscode from 'vscode';
import { selectRemoteCommand } from '../../commands/selectRemote';
import { detectAllGitRemotes } from '../../utils/gitUtils';

// Mock dependencies
jest.mock('../../utils/gitUtils');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockDetectAllGitRemotes = detectAllGitRemotes as jest.MockedFunction<typeof detectAllGitRemotes>;

const mockRemotes = new Map([
  ['origin', { instanceUrl: 'https://git.example.com', owner: 'test-owner', repo: 'test-repo' }],
  ['upstream', { instanceUrl: 'https://git.example.com', owner: 'upstream-owner', repo: 'test-repo' }],
]);

describe('selectRemoteCommand', () => {
  let mockPRTreeProvider: { refresh: jest.Mock };
  let mockIssueTreeProvider: { refresh: jest.Mock };
  let mockActionsTreeProvider: { refresh: jest.Mock };
  let mockConfigUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPRTreeProvider = { refresh: jest.fn() };
    mockIssueTreeProvider = { refresh: jest.fn() };
    mockActionsTreeProvider = { refresh: jest.fn() };

    mockConfigUpdate = jest.fn().mockResolvedValue(undefined);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      update: mockConfigUpdate,
    });

    mockDetectAllGitRemotes.mockReturnValue(mockRemotes);
  });

  it('shows info message and returns early when no git remotes are found', async () => {
    mockDetectAllGitRemotes.mockReturnValueOnce(new Map());

    await selectRemoteCommand(
      mockPRTreeProvider as any,
      mockIssueTreeProvider as any,
      mockActionsTreeProvider as any
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'No git remotes found in the current workspace.'
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(mockConfigUpdate).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('returns early without updating config when user cancels the QuickPick', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await selectRemoteCommand(
      mockPRTreeProvider as any,
      mockIssueTreeProvider as any,
      mockActionsTreeProvider as any
    );

    expect(mockConfigUpdate).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
    expect(mockActionsTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('updates config with correct scope, shows notification, and refreshes all three providers on success', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      label: 'origin',
      description: 'https://git.example.com/test-owner/test-repo',
      remoteName: 'origin',
    });

    await selectRemoteCommand(
      mockPRTreeProvider as any,
      mockIssueTreeProvider as any,
      mockActionsTreeProvider as any
    );

    expect(mockConfigUpdate).toHaveBeenCalledWith(
      'preferredRemote',
      'origin',
      vscode.ConfigurationTarget.Workspace
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Forgejo remote set to: origin'
    );
    expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
    expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
    expect(mockActionsTreeProvider.refresh).toHaveBeenCalled();
  });

  it('shows error message when detectAllGitRemotes throws', async () => {
    mockDetectAllGitRemotes.mockImplementationOnce(() => { throw new Error('git not found'); });

    await selectRemoteCommand(
      mockPRTreeProvider as any,
      mockIssueTreeProvider as any,
      mockActionsTreeProvider as any
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to select git remote: git not found'
    );
    expect(mockConfigUpdate).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });
});
