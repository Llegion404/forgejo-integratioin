import { ForgejoClient } from '../../api/forgejoClient';
import {
  mockFileContentsResponseBase64,
  mockFileContentsResponsePlain,
  mockPlainTextContent,
  mockFileContentsSpecialChars
} from '../fixtures/fileContents';
import { mockAllFileTypes } from '../fixtures/prFiles';
import { mockPRWithRefs, mockPRWithBugfixRefs, mockPRWithMissingRefs } from '../fixtures/prRefs';

describe('ForgejoClient', () => {
  let client: ForgejoClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    client = new ForgejoClient('https://git.example.com', 'test-token');
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  describe('getPullRequestFiles', () => {
    test('should fetch pull request files successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockAllFileTypes
      } as unknown as Response);

      const files = await client.getPullRequestFiles('owner', 'repo', 42);

      expect(files).toEqual(mockAllFileTypes);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42/files',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'token test-token',
            'Accept': 'application/json'
          })
        })
      );
    });

    test('should handle empty file array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as unknown as Response);

      const files = await client.getPullRequestFiles('owner', 'repo', 42);

      expect(files).toEqual([]);
      expect(files.length).toBe(0);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 99999))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow('Failed to fetch from Forgejo: Network timeout');
    });
  });

  describe('getFileContents', () => {
    test('should decode base64 content correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      const content = await client.getFileContents('owner', 'repo', 'src/file.ts', 'main');

      expect(content).toBe(mockPlainTextContent);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/contents/src%2Ffile.ts?ref=main',
        expect.any(Object)
      );
    });

    test('should return plain text content when encoding is not base64', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponsePlain
      } as unknown as Response);

      const content = await client.getFileContents('owner', 'repo', 'src/file.ts', 'main');

      expect(content).toBe(mockPlainTextContent);
    });

    test('should throw error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as unknown as Response);

      await expect(client.getFileContents('owner', 'repo', 'nonexistent.ts', 'main'))
        .rejects
        .toThrow('HTTP 404: Not Found');
    });

    test('should URL encode filepath correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsSpecialChars
      } as unknown as Response);

      await client.getFileContents('owner', 'repo', 'src/file with spaces.ts', 'main');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contents/src%2Ffile%20with%20spaces.ts'),
        expect.any(Object)
      );
    });

    test('should pass ref parameter correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      await client.getFileContents('owner', 'repo', 'src/file.ts', 'feature/branch-name');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/contents/src%2Ffile.ts?ref=feature/branch-name',
        expect.any(Object)
      );
    });
  });

  describe('getPullRequestRefs', () => {
    test('should extract base and head refs from PR details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 42);

      expect(refs).toEqual({
        base: 'main',
        head: 'feature/new-feature'
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42',
        expect.any(Object)
      );
    });

    test('should handle different branch names', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithBugfixRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 43);

      expect(refs).toEqual({
        base: 'develop',
        head: 'bugfix/fix-issue-123'
      });
    });

    test('should return empty strings when refs are missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPRWithMissingRefs
      } as unknown as Response);

      const refs = await client.getPullRequestRefs('owner', 'repo', 44);

      expect(refs).toEqual({
        base: '',
        head: ''
      });
    });
  });

  describe('Authentication', () => {
    test('should include auth token in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      await client.getPullRequestFiles('owner', 'repo', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should work without token', async () => {
      const clientWithoutToken = new ForgejoClient('https://git.example.com');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      await clientWithoutToken.getPullRequestFiles('owner', 'repo', 42);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new Error('Invalid JSON');
        }
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow('Failed to fetch from Forgejo: Invalid JSON');
    });

    test('should handle HTTP 500 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as unknown as Response);

      await expect(client.getFileContents('owner', 'repo', 'file.ts', 'main'))
        .rejects
        .toThrow('HTTP 500: Internal Server Error');
    });

    test('should handle HTTP 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as unknown as Response);

      await expect(client.getPullRequestRefs('owner', 'repo', 42))
        .rejects
        .toThrow('HTTP 401: Unauthorized');
    });
  });

  describe('URL Construction', () => {
    test('should construct correct API URL for getPullRequestFiles', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response);

      await client.getPullRequestFiles('test-owner', 'test-repo', 123);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/test-owner/test-repo/pulls/123/files',
        expect.any(Object)
      );
    });

    test('should construct correct API URL for getFileContents', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockFileContentsResponseBase64
      } as unknown as Response);

      await client.getFileContents('test-owner', 'test-repo', 'path/to/file.ts', 'test-branch');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/test-owner/test-repo/contents/path%2Fto%2Ffile.ts?ref=test-branch',
        expect.any(Object)
      );
    });

    test('should construct correct API URL for getPullRequestRefs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockPRWithRefs
      } as unknown as Response);

      await client.getPullRequestRefs('test-owner', 'test-repo', 456);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/test-owner/test-repo/pulls/456',
        expect.any(Object)
      );
    });
  });
});
