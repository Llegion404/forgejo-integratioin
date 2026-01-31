import * as vscode from 'vscode';
import { PRDiffContentProvider, createPRFileUri, PR_DIFF_SCHEME } from '../../providers/prDiffContentProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { mockPlainTextContent, mockModifiedContent } from '../fixtures/fileContents';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('PRDiffContentProvider', () => {
  let provider: PRDiffContentProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;

  beforeEach(() => {
    provider = new PRDiffContentProvider();
    mockClient = {
      getFileContents: jest.fn()
    } as any;
    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;

    // Reset mocks
    jest.clearAllMocks();

    // Mock ForgejoClient constructor
    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);
  });

  describe('URI Parsing', () => {
    test('should parse valid URI with simple filepath', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/file.ts', 'main');
    });

    test('should parse valid URI with nested filepath', async () => {
      const uri = createPRFileUri('owner', 'repo', 'feature-branch', 'src/deep/nested/path/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/deep/nested/path/file.ts', 'feature-branch');
    });

    test('should handle URI with special characters in filepath', async () => {
      // Create URI using the helper function to ensure proper encoding
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file with spaces.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);

      expect(mockClient.getFileContents).toHaveBeenCalledWith('owner', 'repo', 'src/file%20with%20spaces.ts', 'main');
    });

    test('should throw error for invalid URI with too few parts', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo');

      await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow('Invalid PR diff URI format');
    });

    test('should throw error for invalid URI with only owner', async () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner');

      await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow('Invalid PR diff URI format');
    });
  });

  describe('Content Fetching', () => {
    test('should fetch and return file content successfully', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1);
    });

    test('should use cached content on second request', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      // First request - should fetch
      const content1 = await provider.provideTextDocumentContent(uri);
      expect(content1).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const content2 = await provider.provideTextDocumentContent(uri);
      expect(content2).toBe(mockPlainTextContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    test('should return error message when config is missing', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue(null);

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: Forgejo configuration not found');
      expect(content).toContain('// URI:');
      expect(mockClient.getFileContents).not.toHaveBeenCalled();
    });

    test('should return error message when API call fails', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockRejectedValue(new Error('HTTP 404: Not Found'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: HTTP 404: Not Found');
      expect(content).toContain('// URI:');
    });

    test('should handle network errors gracefully', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockRejectedValue(new Error('Network error'));

      const content = await provider.provideTextDocumentContent(uri);

      expect(content).toContain('// Error: Network error');
    });
  });

  describe('Caching', () => {
    test('should cache content after successful fetch', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      await provider.provideTextDocumentContent(uri);
      mockClient.getFileContents.mockResolvedValue(mockModifiedContent); // Change mock return value

      // Second call should return cached content, not the new mocked value
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockPlainTextContent); // Original content, not modified
    });

    test('should clear cache for specific URI', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      // Fetch and cache
      await provider.provideTextDocumentContent(uri);

      // Clear cache for this URI
      provider.clearCache(uri);

      // Should fetch again
      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockModifiedContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);
    });

    test('should clear all cache when called without URI', async () => {
      const uri1 = createPRFileUri('owner', 'repo', 'main', 'src/file1.ts');
      const uri2 = createPRFileUri('owner', 'repo', 'main', 'src/file2.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      // Fetch and cache both
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);

      // Clear all cache
      provider.clearCache();

      // Should fetch again for both
      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      await provider.provideTextDocumentContent(uri1);
      await provider.provideTextDocumentContent(uri2);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(4);
    });
  });

  describe('Refresh', () => {
    test('should clear cache and fire change event', async () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');
      mockGetForgejoConfig.mockResolvedValue({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo',
        token: 'test-token'
      });
      mockClient.getFileContents.mockResolvedValue(mockPlainTextContent);

      // Set up event listener
      let eventFired = false;
      let eventUri: vscode.Uri | undefined;
      provider.onDidChange((uri) => {
        eventFired = true;
        eventUri = uri;
      });

      // Fetch and cache
      await provider.provideTextDocumentContent(uri);

      // Refresh
      provider.refresh(uri);

      expect(eventFired).toBe(true);
      expect(eventUri).toBe(uri);

      // Should fetch again after refresh
      mockClient.getFileContents.mockResolvedValue(mockModifiedContent);
      const content = await provider.provideTextDocumentContent(uri);
      expect(content).toBe(mockModifiedContent);
      expect(mockClient.getFileContents).toHaveBeenCalledTimes(2);
    });

    test('should fire change event even if content was not cached', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');

      let eventFired = false;
      provider.onDidChange(() => {
        eventFired = true;
      });

      provider.refresh(uri);

      expect(eventFired).toBe(true);
    });
  });

  describe('createPRFileUri Helper Function', () => {
    test('should create valid URI for simple filepath', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file.ts');

      expect(uri.scheme).toBe(PR_DIFF_SCHEME);
      expect(uri.path).toBe('/owner/repo/main/src/file.ts');
      expect(uri.toString()).toBe('forgejo-pr:/owner/repo/main/src/file.ts');
    });

    test('should encode special characters in filepath', () => {
      const uri = createPRFileUri('owner', 'repo', 'main', 'src/file with spaces.ts');

      expect(uri.path).toContain('file%20with%20spaces.ts');
      expect(uri.toString()).toContain('file%20with%20spaces.ts');
    });

    test('should handle nested paths correctly', () => {
      const uri = createPRFileUri('owner', 'repo', 'feature/branch', 'src/deep/nested/path/file.ts');

      expect(uri.path).toBe('/owner/repo/feature/branch/src/deep/nested/path/file.ts');
      expect(uri.toString()).toBe('forgejo-pr:/owner/repo/feature/branch/src/deep/nested/path/file.ts');
    });
  });
});
