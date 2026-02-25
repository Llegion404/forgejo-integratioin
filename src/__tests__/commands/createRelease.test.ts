import * as vscode from 'vscode';
import { createReleaseCommand } from '../../commands/createRelease';
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

const mockTags = [
  { name: 'v1.0.0', commit: { sha: 'abc1234def5678' } },
  { name: 'v0.9.0', commit: { sha: 'fed4321cba8765' } },
];

const mockRelease = {
  id: 1,
  tag_name: 'v1.0.0',
  name: 'Version 1.0.0',
  html_url: 'https://git.example.com/test-owner/test-repo/releases/tag/v1.0.0',
};

describe('createReleaseCommand', () => {
  let mockReleaseTreeProvider: { refresh: jest.Mock };
  let mockListTags: jest.Mock;
  let mockCreateRelease: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReleaseTreeProvider = { refresh: jest.fn() };
    mockListTags = jest.fn().mockResolvedValue(mockTags);
    mockCreateRelease = jest.fn().mockResolvedValue(mockRelease);
    MockForgejoClient.mockImplementation(() => ({
      listTags: mockListTags,
      createRelease: mockCreateRelease,
    } as any));
  });

  // ── Config check ──────────────────────────────────────────────────────────

  it('shows error and returns early when config is null', async () => {
    mockGetForgejoConfig.mockResolvedValue(null);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Forgejo configuration not found. Please configure an instance first.'
    );
    expect(mockListTags).not.toHaveBeenCalled();
    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
  });

  it('shows error and returns early when token is missing', async () => {
    mockGetForgejoConfig.mockResolvedValue({ ...mockConfig, token: '' });

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'A Forgejo token is required to create releases. Please configure your token first.'
    );
    expect(MockForgejoClient).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
  });

  // ── Tag fetch failure ─────────────────────────────────────────────────────

  it('silently continues when listTags throws, showing InputBox for tag name', async () => {
    const { logInfo } = require('../../utils/logger');
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockListTags.mockRejectedValueOnce(new Error('Network error'));
    // No tags → InputBox path; user cancels to keep test contained
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    // Should NOT throw; should log the fallback message
    expect(logInfo).toHaveBeenCalledWith('Could not fetch tags, allowing manual entry');
    // QuickPick must NOT have been shown (no tags available)
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    // InputBox was shown for manual tag entry
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  // ── Tag selection — existing tags available ───────────────────────────────

  it('shows QuickPick with tags + "Enter new tag" option when tags exist', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    // User cancels the QuickPick
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining('Enter new tag name') }),
        expect.objectContaining({ label: 'v1.0.0' }),
        expect.objectContaining({ label: 'v0.9.0' }),
      ]),
      expect.objectContaining({ title: 'Create Release: Select Tag' })
    );
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  it('uses selected existing tag label as tagName', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    // User picks an existing tag
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0', description: 'abc1234' })
      // release type
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Version 1.0.0')  // release name
      .mockResolvedValueOnce('Release notes');   // release body
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).toHaveBeenCalledWith(
      'test-owner', 'test-repo',
      expect.objectContaining({ tag_name: 'v1.0.0' })
    );
  });

  it('shows InputBox for new tag when user picks "Enter new tag name..." option', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    // User picks the "Enter new tag name..." option
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      label: '$(add) Enter new tag name...',
      description: 'Type a new tag',
    });
    // Then cancels the InputBox
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Create Release: New Tag' })
    );
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  // ── Tag selection — no existing tags ──────────────────────────────────────

  it('shows InputBox directly for tag name when no tags exist', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockListTags.mockResolvedValueOnce([]);
    // User cancels
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Create Release: Tag' })
    );
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  // ── Cancellation paths ────────────────────────────────────────────────────

  it('returns early when user cancels the tag QuickPick', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
    // Only the tag QuickPick should have been shown
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it('returns early when user cancels the tag InputBox (no-tags path)', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    mockListTags.mockResolvedValueOnce([]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
  });

  it('returns early when user cancels the release name InputBox', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    // Pick existing tag
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'v1.0.0' });
    // Cancel release name
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
  });

  it('returns early when user cancels the release notes InputBox', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ label: 'v1.0.0' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')  // release name
      .mockResolvedValueOnce(undefined);     // cancel notes

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(2);
  });

  it('returns early when user cancels the release type QuickPick', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })   // tag selection
      .mockResolvedValueOnce(undefined);              // cancel type
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')
      .mockResolvedValueOnce('Release notes');

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).not.toHaveBeenCalled();
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
  });

  // ── Release type → API param mappings ────────────────────────────────────

  it('passes draft:false, prerelease:false for Release type', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')
      .mockResolvedValueOnce('Notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).toHaveBeenCalledWith(
      'test-owner', 'test-repo',
      expect.objectContaining({ draft: false, prerelease: false })
    );
  });

  it('passes draft:false, prerelease:true for Pre-release type', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Pre-release', value: 'prerelease' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')
      .mockResolvedValueOnce('Notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).toHaveBeenCalledWith(
      'test-owner', 'test-repo',
      expect.objectContaining({ draft: false, prerelease: true })
    );
  });

  it('passes draft:true, prerelease:false for Draft type', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Draft', value: 'draft' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')
      .mockResolvedValueOnce('Notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).toHaveBeenCalledWith(
      'test-owner', 'test-repo',
      expect.objectContaining({ draft: true, prerelease: false })
    );
  });

  // ── Name fallback ─────────────────────────────────────────────────────────

  it('falls back to tag name when release name is empty', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v2.0.0' })
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('')   // empty release name → fallback to tag name
      .mockResolvedValueOnce('Notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockCreateRelease).toHaveBeenCalledWith(
      'test-owner', 'test-repo',
      expect.objectContaining({ tag_name: 'v2.0.0', name: 'v2.0.0' })
    );
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('shows error message when createRelease API call fails', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('My Release')
      .mockResolvedValueOnce('Notes');
    mockCreateRelease.mockRejectedValueOnce(new Error('API error'));

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to create release: API error'
    );
    expect(mockReleaseTreeProvider.refresh).not.toHaveBeenCalled();
  });

  // ── Success paths ─────────────────────────────────────────────────────────

  it('refreshes tree and opens browser when "Open in Browser" is chosen', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Version 1.0.0')
      .mockResolvedValueOnce('Release notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Open in Browser');

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockReleaseTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      `Release "${mockRelease.name || mockRelease.tag_name}" created successfully`,
      'Open in Browser'
    );
    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      vscode.Uri.parse(mockRelease.html_url)
    );
  });

  it('refreshes tree but does not open browser when notification is dismissed', async () => {
    mockGetForgejoConfig.mockResolvedValue(mockConfig);
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: 'v1.0.0' })
      .mockResolvedValueOnce({ label: 'Release', value: 'release' });
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Version 1.0.0')
      .mockResolvedValueOnce('Release notes');
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce(undefined);

    await createReleaseCommand(mockReleaseTreeProvider as any);

    expect(mockReleaseTreeProvider.refresh).toHaveBeenCalled();
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });
});
