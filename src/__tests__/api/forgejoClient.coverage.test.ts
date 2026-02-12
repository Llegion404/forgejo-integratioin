import { ForgejoClient } from '../../api/forgejoClient';

describe('ForgejoClient - Coverage Gaps', () => {
  let client: ForgejoClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    client = new ForgejoClient('https://git.example.com', 'test-token');
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  describe('testConnection', () => {
    test('should return true on successful connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ version: '1.21.0' })
      } as unknown as Response);

      const result = await client.testConnection();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/version',
        expect.any(Object)
      );
    });

    test('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should return false on HTTP 401 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as unknown as Response);

      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should return false on HTTP 403 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      } as unknown as Response);

      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should return false on HTTP 404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as unknown as Response);

      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should return false on HTTP 500 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as unknown as Response);

      const result = await client.testConnection();
      expect(result).toBe(false);
    });

    test('should return false on non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('updatePullRequestBody', () => {
    test('should update PR body successfully', async () => {
      const updatedPR = { number: 42, body: 'Updated body', state: 'open' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedPR
      } as unknown as Response);

      const result = await client.updatePullRequestBody('owner', 'repo', 42, 'Updated body');

      expect(result).toEqual(updatedPR);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/pulls/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ body: 'Updated body' })
        })
      );
    });

    test('should include auth token in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ number: 42 })
      } as unknown as Response);

      await client.updatePullRequestBody('owner', 'repo', 42, 'body');

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
      const noTokenClient = new ForgejoClient('https://git.example.com');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ number: 42 })
      } as unknown as Response);

      await noTokenClient.updatePullRequestBody('owner', 'repo', 42, 'body');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    test('should throw error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Permission denied'
      } as unknown as Response);

      await expect(client.updatePullRequestBody('owner', 'repo', 42, 'body'))
        .rejects
        .toThrow('HTTP 403: Forbidden');
    });

    test('should handle non-Error thrown values', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      await expect(client.updatePullRequestBody('owner', 'repo', 42, 'body'))
        .rejects
        .toThrow('Failed to update pull request body: string error');
    });
  });

  describe('updateIssueBody', () => {
    test('should update issue body successfully', async () => {
      const updatedIssue = { number: 10, body: 'Updated body', state: 'open' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedIssue
      } as unknown as Response);

      const result = await client.updateIssueBody('owner', 'repo', 10, 'Updated body');

      expect(result).toEqual(updatedIssue);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues/10',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ body: 'Updated body' })
        })
      );
    });

    test('should include auth token in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ number: 10 })
      } as unknown as Response);

      await client.updateIssueBody('owner', 'repo', 10, 'body');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-token'
          })
        })
      );
    });

    test('should throw error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      } as unknown as Response);

      await expect(client.updateIssueBody('owner', 'repo', 10, 'body'))
        .rejects
        .toThrow('HTTP 500: Internal Server Error');
    });

    test('should handle non-Error thrown values', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      await expect(client.updateIssueBody('owner', 'repo', 10, 'body'))
        .rejects
        .toThrow('Failed to update issue body: string error');
    });
  });

  describe('request() error handling', () => {
    test('should handle TypeError from fetch (network error)', async () => {
      const fetchError = new TypeError('fetch failed');
      mockFetch.mockRejectedValueOnce(fetchError);

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow('Network error: Cannot reach https://git.example.com');
    });

    test('should handle non-Error thrown from request', async () => {
      mockFetch.mockRejectedValueOnce('some string error');

      // Non-Error values should be rethrown
      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toBe('some string error');
    });

    test('should read error body from failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () => 'Validation failed'
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow('HTTP 422: Unprocessable Entity');
    });

    test('should handle response.text() failure when reading error body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => { throw new Error('stream error'); }
      } as unknown as Response);

      await expect(client.getPullRequestFiles('owner', 'repo', 42))
        .rejects
        .toThrow('HTTP 500: Internal Server Error');
    });
  });

  describe('getIssueDetails', () => {
    test('should fetch issue details', async () => {
      const mockIssue = { number: 5, title: 'Test Issue', state: 'open' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIssue
      } as unknown as Response);

      const result = await client.getIssueDetails('owner', 'repo', 5);
      expect(result).toEqual(mockIssue);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/owner/repo/issues/5',
        expect.any(Object)
      );
    });
  });
});
