import * as vscode from 'vscode';
import { closePrCommand } from '../../commands/closePr';
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

const mockPr = {
  number: 42,
  title: 'Fix critical bug',
} as any;

describe('closePrCommand', () => {
  let mockPrTreeProvider: { refresh: jest.Mock };
  let mockClosePullRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrTreeProvider = { refresh: jest.fn() };
    mockClosePullRequest = jest.fn().mockResolvedValue(undefined);
    MockForgejoClient.mockImplementation(() => ({
      closePullRequest: mockClosePullRequest,
    } as any));
  });

  it('returns early without API call when user cancels confirmation', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await closePrCommand(mockPr, 'owner', 'repo', mockPrTreeProvider as any);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      `Are you sure you want to close PR #${mockPr.number}: "${mockPr.title}"?`,
      { modal: true },
      'Close PR'
    );
    expect(MockForgejoClient).not.toHaveBeenCalled();
    expect(mockClosePullRequest).not.toHaveBeenCalled();
    expect(mockPrTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error and returns early when config is null after confirmation', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Close PR');
    mockGetForgejoConfig.mockResolvedValue(null);

    await closePrCommand(mockPr, 'owner', 'repo', mockPrTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Forgejo configuration not found'
    );
    expect(MockForgejoClient).not.toHaveBeenCalled();
    expect(mockClosePullRequest).not.toHaveBeenCalled();
    expect(mockPrTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error message when API call fails', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Close PR');
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockClosePullRequest.mockRejectedValueOnce(new Error('API error'));

    await closePrCommand(mockPr, 'owner', 'repo', mockPrTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to close PR: API error'
    );
    expect(mockPrTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows success notification and refreshes tree on success', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Close PR');
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    await closePrCommand(mockPr, 'test-owner', 'test-repo', mockPrTreeProvider as any);

    expect(mockClosePullRequest).toHaveBeenCalledWith('test-owner', 'test-repo', mockPr.number);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      `PR #${mockPr.number} closed successfully!`
    );
    expect(mockPrTreeProvider.refresh).toHaveBeenCalled();
  });
});
