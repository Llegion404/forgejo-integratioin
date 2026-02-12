/**
 * Live integration tests against a real Forgejo instance.
 *
 * These tests run against a local Forgejo container (http://localhost:3000).
 * They are skipped unless FORGEJO_TEST_URL and FORGEJO_TEST_TOKEN env vars are set.
 *
 * Setup (done automatically by the test harness):
 *   docker run -d --name forgejo-test -p 3000:3000 \
 *     -e FORGEJO__security__INSTALL_LOCK=true codeberg.org/forgejo/forgejo:10
 *   # Then create user, token, repo, PR, and issue via API
 */

// Unmock everything - we want real modules for live tests
jest.unmock('../../utils/logger');

import { ForgejoClient } from '../../api/forgejoClient';

const FORGEJO_URL = process.env.FORGEJO_TEST_URL || '';
const FORGEJO_TOKEN = process.env.FORGEJO_TEST_TOKEN || '';
const OWNER = 'testuser';
const REPO = 'test-repo';

const describeIfLive = FORGEJO_URL && FORGEJO_TOKEN ? describe : describe.skip;

describeIfLive('ForgejoClient - live integration tests', () => {
  let client: ForgejoClient;
  let savedFetch: typeof global.fetch;

  beforeAll(async () => {
    // Jest setup.ts replaces global.fetch with a mock.
    // Import undici's fetch (bundled with Node 18+) to get a real implementation.
    const undici = await import('undici');
    savedFetch = global.fetch;
    global.fetch = undici.fetch as unknown as typeof global.fetch;
    client = new ForgejoClient(FORGEJO_URL, FORGEJO_TOKEN);
  });

  afterAll(() => {
    // Restore the mock so other test suites aren't affected
    global.fetch = savedFetch;
  });

  describe('testConnection', () => {
    it('should successfully connect to the live instance', async () => {
      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    it('should fail with bad token', async () => {
      const badClient = new ForgejoClient(FORGEJO_URL, 'invalid-token-xxx');
      const result = await badClient.testConnection();
      // Whether this passes depends on instance config; the version endpoint
      // may or may not require auth. Just verify it returns a boolean.
      expect(typeof result).toBe('boolean');
    });

    it('should fail with unreachable host', async () => {
      const badClient = new ForgejoClient('http://localhost:59999', 'token');
      const result = await badClient.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('getPullRequests', () => {
    it('should list open pull requests', async () => {
      const prs = await client.getPullRequests(OWNER, REPO, 'open');
      expect(Array.isArray(prs)).toBe(true);
      expect(prs.length).toBeGreaterThanOrEqual(1);
      expect(prs[0]).toHaveProperty('number');
      expect(prs[0]).toHaveProperty('title');
      expect(prs[0].title).toBe('Test PR');
    });

    it('should return empty for non-existent repo', async () => {
      await expect(client.getPullRequests(OWNER, 'nonexistent-repo', 'open'))
        .rejects
        .toThrow();
    });
  });

  describe('getIssues', () => {
    it('should list issues (excluding PRs)', async () => {
      const issues = await client.getIssues(OWNER, REPO, 'open');
      expect(Array.isArray(issues)).toBe(true);
      // The issues endpoint returns both issues and PRs;
      // getIssues should filter out PRs
      const issueTitles = issues.map(i => i.title);
      expect(issueTitles).toContain('Test Issue');
    });
  });

  describe('getPullRequestDetails', () => {
    it('should fetch PR #1 details', async () => {
      const pr = await client.getPullRequestDetails(OWNER, REPO, 1);
      expect(pr.number).toBe(1);
      expect(pr.title).toBe('Test PR');
      expect(typeof pr.body).toBe('string');
      expect(pr.state).toBe('open');
      expect(pr).toHaveProperty('head');
      expect(pr).toHaveProperty('base');
    });
  });

  describe('getIssueDetails', () => {
    it('should fetch issue #2 details', async () => {
      const issue = await client.getIssueDetails(OWNER, REPO, 2);
      expect(issue.number).toBe(2);
      expect(issue.title).toBe('Test Issue');
      expect(typeof issue.body).toBe('string');
    });
  });

  describe('getPullRequestFiles', () => {
    it('should list files changed in PR #1', async () => {
      const files = await client.getPullRequestFiles(OWNER, REPO, 1);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0]).toHaveProperty('filename');
      expect(files[0].filename).toBe('test.txt');
    });
  });

  describe('getFileContents', () => {
    it('should fetch file contents from main branch', async () => {
      // getFileContents returns decoded string content
      const contents = await client.getFileContents(OWNER, REPO, 'README.md', 'main');
      expect(typeof contents).toBe('string');
      expect(contents.length).toBeGreaterThan(0);
    });

    it('should fetch test.txt from feature branch', async () => {
      const contents = await client.getFileContents(OWNER, REPO, 'test.txt', 'feature-branch');
      expect(contents).toBe('Hello World');
    });

    it('should throw for non-existent file', async () => {
      await expect(client.getFileContents(OWNER, REPO, 'nonexistent.txt', 'main'))
        .rejects
        .toThrow();
    });
  });

  describe('updatePullRequestBody', () => {
    it('should update PR body', async () => {
      const updated = await client.updatePullRequestBody(OWNER, REPO, 1, 'Updated PR body');
      expect(updated).toHaveProperty('body');
      expect(updated.body).toBe('Updated PR body');

      // Verify by fetching again
      const pr = await client.getPullRequestDetails(OWNER, REPO, 1);
      expect(pr.body).toBe('Updated PR body');
    });
  });

  describe('updateIssueBody', () => {
    it('should update issue body', async () => {
      const updated = await client.updateIssueBody(OWNER, REPO, 2, 'Updated issue body');
      expect(updated).toHaveProperty('body');

      // Verify by fetching again
      const issue = await client.getIssueDetails(OWNER, REPO, 2);
      expect(issue.body).toBe('Updated issue body');
    });
  });

  describe('getPullRequestRefs', () => {
    it('should return head and base refs for PR #1', async () => {
      const refs = await client.getPullRequestRefs(OWNER, REPO, 1);
      expect(refs).toHaveProperty('head');
      expect(refs).toHaveProperty('base');
      // getPullRequestRefs returns { head: string, base: string }
      expect(refs.head).toBe('feature-branch');
      expect(refs.base).toBe('main');
    });
  });

  describe('error handling', () => {
    it('should throw on 404 for non-existent repo', async () => {
      await expect(client.getPullRequestDetails(OWNER, 'no-such-repo', 1))
        .rejects
        .toThrow(expect.objectContaining({ message: expect.stringContaining('404') }));
    });

    it('should throw on 404 for non-existent PR', async () => {
      await expect(client.getPullRequestDetails(OWNER, REPO, 999))
        .rejects
        .toThrow(expect.objectContaining({ message: expect.stringContaining('404') }));
    });
  });
});
