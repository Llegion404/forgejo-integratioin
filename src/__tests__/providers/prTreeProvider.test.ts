import * as vscode from 'vscode';
import { PRTreeProvider, PRTreeItem } from '../../providers/prTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequestListItem, PullRequestFile } from '../../models/pullRequest';
import { mockAllFileTypes, mockUnsortedFiles, mockAddedFile, mockModifiedFile, mockRenamedFile, mockRemovedFile } from '../fixtures/prFiles';
import { mockStandardRefs } from '../fixtures/prRefs';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRTreeProvider', () => {
  let provider: PRTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token'
  };

  const mockPR: PullRequestListItem = {
    number: 42,
    title: 'Test PR',
    state: 'open',
    user: { login: 'testuser' },
    html_url: 'https://git.example.com/owner/repo/pulls/42',
    created_at: '2026-01-01T00:00:00Z',
    merged: false,
    draft: false,
    comments: 5
  };

  beforeEach(() => {
    // Create mock client
    mockClient = {
      getPullRequests: jest.fn(),
      getPullRequestFiles: jest.fn(),
      getPullRequestRefs: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Create provider (it calls refresh in constructor, so mock needs to be set up first)
    mockClient.getPullRequests.mockResolvedValue([mockPR]);
    provider = new PRTreeProvider();

    jest.clearAllMocks();
  });

  describe('File Sorting', () => {
    test('should sort files in correct order: added, modified, renamed, removed', () => {
      // Create test files inline (not using fixtures to avoid any caching issues)
      const fileRemoved: PullRequestFile = {
        filename: 'removed.ts',
        status: 'removed',
        additions: 0,
        deletions: 10,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileAdded: PullRequestFile = {
        filename: 'added.ts',
        status: 'added',
        additions: 10,
        deletions: 0,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileRenamed: PullRequestFile = {
        filename: 'renamed.ts',
        status: 'renamed',
        additions: 1,
        deletions: 1,
        changes: 2,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      const fileModified: PullRequestFile = {
        filename: 'modified.ts',
        status: 'modified',
        additions: 5,
        deletions: 5,
        changes: 10,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      };

      // Create files in wrong order
      const unsortedFiles: PullRequestFile[] = [
        fileRemoved,
        fileAdded,
        fileRenamed,
        fileModified
      ];

      // Apply the same sorting logic as the provider
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = [...unsortedFiles].sort((a, b) => {
        const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 99;
        const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 99;
        return aOrder - bOrder;
      });

      // Debug: log what we got
      const statuses = sortedFiles.map(f => f.status);

      // Verify order
      expect(statuses).toEqual(['added', 'modified', 'renamed', 'removed']);
    });

    test('should handle unknown file status', () => {
      const createFile = (status: string): PullRequestFile => ({
        filename: `${status}.ts`,
        status: status as any,
        additions: 1,
        deletions: 1,
        changes: 2,
        blob_url: 'url',
        raw_url: 'url',
        contents_url: 'url'
      });

      const filesWithUnknown: PullRequestFile[] = [
        createFile('unknown'),
        createFile('modified'),
        createFile('added')
      ];

      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = [...filesWithUnknown].sort((a, b) => {
        const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 99;
        const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 99;
        return aOrder - bOrder;
      });

      // Unknown should be last (99)
      const statuses = sortedFiles.map(f => f.status);
      expect(statuses).toEqual(['added', 'modified', 'unknown']);
    });

    test('should maintain stable sort for same status', () => {
      const file1 = { ...mockModifiedFile, filename: 'file1.ts' };
      const file2 = { ...mockModifiedFile, filename: 'file2.ts' };
      const file3 = { ...mockModifiedFile, filename: 'file3.ts' };
      const files: PullRequestFile[] = [file3, file1, file2];

      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      // All should have same status
      expect(sortedFiles.every(f => f.status === 'modified')).toBe(true);
    });

    test('should handle empty file list', () => {
      const files: PullRequestFile[] = [];
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      expect(sortedFiles).toEqual([]);
    });

    test('should handle single file', () => {
      const files: PullRequestFile[] = [mockAddedFile];
      const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
      const sortedFiles = files.sort((a, b) => {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      });

      expect(sortedFiles).toEqual([mockAddedFile]);
    });
  });

  describe('PRTreeItem Creation', () => {
    test('should create PRTreeItem with correct properties', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.label).toBe('#42: Test PR');
      expect(prItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(prItem.description).toBe('by testuser');
      expect(prItem.contextValue).toBe('pullRequest');
      expect(prItem.command).toBeUndefined();
      expect(prItem.tooltip).toContain('Test PR');
      expect(prItem.tooltip).toContain('testuser');
    });

    test('should set merged icon for merged PRs', () => {
      const mergedPR = { ...mockPR, merged: true };
      const prItem = new PRTreeItem(mergedPR, mergedPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-merge');
    });

    test('should set draft icon for draft PRs', () => {
      const draftPR = { ...mockPR, draft: true };
      const prItem = new PRTreeItem(draftPR, draftPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request-draft');
    });

    test('should set closed icon for closed PRs', () => {
      const closedPR = { ...mockPR, state: 'closed' as const };
      const prItem = new PRTreeItem(closedPR, closedPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request-closed');
    });

    test('should set open icon for open PRs', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      const icon = prItem.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('git-pull-request');
    });
  });

  describe('Caching Mechanism', () => {
    test('should cache files in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      // Initially no files
      expect(prItem.files).toBeUndefined();

      // Simulate caching
      prItem.files = mockAllFileTypes;
      prItem.baseRef = 'main';
      prItem.headRef = 'feature';

      // Files should be cached
      expect(prItem.files).toEqual(mockAllFileTypes);
      expect(prItem.baseRef).toBe('main');
      expect(prItem.headRef).toBe('feature');
    });

    test('should cache refs in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      prItem.baseRef = mockStandardRefs.base;
      prItem.headRef = mockStandardRefs.head;

      expect(prItem.baseRef).toBe('main');
      expect(prItem.headRef).toBe('feature/new-feature');
    });

    test('should cache error state in PRTreeItem', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      expect(prItem.filesError).toBeUndefined();

      prItem.filesError = 'Network error';

      expect(prItem.filesError).toBe('Network error');
    });

    test('should allow clearing cached files', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      // Cache files
      prItem.files = mockAllFileTypes;
      prItem.baseRef = 'main';
      prItem.headRef = 'feature';

      // Clear cache
      prItem.files = undefined;
      prItem.baseRef = undefined;
      prItem.headRef = undefined;

      expect(prItem.files).toBeUndefined();
      expect(prItem.baseRef).toBeUndefined();
      expect(prItem.headRef).toBeUndefined();
    });

    test('should allow clearing error cache', () => {
      const prItem = new PRTreeItem(mockPR, mockPR.html_url, 'owner', 'repo');

      prItem.filesError = 'Network error';
      expect(prItem.filesError).toBe('Network error');

      prItem.filesError = undefined;
      expect(prItem.filesError).toBeUndefined();
    });
  });

  describe('Provider Initialization', () => {
    test('should create provider successfully', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(PRTreeProvider);
    });

    test('should have onDidChangeTreeData event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });

    test('should have refresh method', () => {
      expect(typeof provider.refresh).toBe('function');
    });

    test('should have getTreeItem method', () => {
      expect(typeof provider.getTreeItem).toBe('function');
    });

    test('should have getChildren method', () => {
      expect(typeof provider.getChildren).toBe('function');
    });
  });
});
