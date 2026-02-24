import * as vscode from 'vscode';
import { mergePrCommand } from '../../commands/mergePr';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

const mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
const MockForgejoClient = ForgejoClient as jest.MockedClass<typeof ForgejoClient>;

const mockConfig = {
  instanceUrl: 'https://git.example.com',
  owner: 'test-owner',
  repo: 'test-repo',
  token: 'test-token',
};

const mockPR = {
  number: 42,
  title: 'My Feature Branch',
} as any;

describe('mergePrCommand', () => {
  let mockPRTreeProvider: { refresh: jest.Mock };
  let mockMergePullRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPRTreeProvider = { refresh: jest.fn() };
    mockMergePullRequest = jest.fn().mockResolvedValue(undefined);
    MockForgejoClient.mockImplementation(() => ({
      mergePullRequest: mockMergePullRequest,
    } as any));
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
  });

  it('returns early when user cancels the merge strategy QuickPick', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await mergePrCommand(mockPR, 'test-owner', 'test-repo', mockPRTreeProvider as any);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(mockMergePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('returns early when user cancels the confirmation dialog', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'Create merge commit', value: 'merge' });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined); // dismissed without clicking 'Merge'

    await mergePrCommand(mockPR, 'test-owner', 'test-repo', mockPRTreeProvider as any);

    expect(mockMergePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error when config is null at API call time', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'Create merge commit', value: 'merge' });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Merge');
    mockGetForgejoConfig.mockResolvedValueOnce(null);

    await mergePrCommand(mockPR, 'test-owner', 'test-repo', mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Forgejo configuration not found');
    expect(mockMergePullRequest).not.toHaveBeenCalled();
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error message when API call fails', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'Create merge commit', value: 'merge' });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Merge');
    mockMergePullRequest.mockRejectedValueOnce(new Error('Merge conflict'));

    await mergePrCommand(mockPR, 'test-owner', 'test-repo', mockPRTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to merge PR: Merge conflict'
    );
    expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows success notification and refreshes tree on success, passing the selected strategy', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'Squash and merge', value: 'squash' });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Merge');

    await mergePrCommand(mockPR, 'test-owner', 'test-repo', mockPRTreeProvider as any);

    expect(mockMergePullRequest).toHaveBeenCalledWith('test-owner', 'test-repo', 42, 'squash');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('PR #42 merged successfully!');
    expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
  });
});
