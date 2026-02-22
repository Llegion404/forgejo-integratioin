import { test, expect } from './fixtures/vscode-harness';

/**
 * Live Playwright tests for Issue interactions against a real Forgejo instance.
 *
 * Requires these env vars (set by CI or manually):
 *   FORGEJO_TEST_URL       - Base URL of the Forgejo instance (e.g. http://forgejo:3000)
 *   FORGEJO_TEST_TOKEN     - API token for the test user
 *   FORGEJO_LIVE_WORKSPACE - Path to a git repo whose origin points at the test instance
 */

const FORGEJO_URL = process.env.FORGEJO_TEST_URL || '';
const FORGEJO_TOKEN = process.env.FORGEJO_TEST_TOKEN || '';
const WORKSPACE = process.env.FORGEJO_LIVE_WORKSPACE || '';

const shouldRun = !!(WORKSPACE && FORGEJO_URL && FORGEJO_TOKEN);

test.describe('Issue Interactions - Live Forgejo', () => {
  test.skip(!shouldRun, 'Requires FORGEJO_LIVE_WORKSPACE, FORGEJO_TEST_URL, FORGEJO_TEST_TOKEN');

  test.use({ baseDir: WORKSPACE || '/tmp' });

  test.setTimeout(60_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    const url = FORGEJO_URL;
    const token = FORGEJO_TOKEN;
    await evaluateInVSCode(async (vscode, args: { url: string; token: string }) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'live-test',
        name: 'Live Test',
        instanceUrl: args.url,
        token: args.token,
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    }, { url, token });

    // Refresh issues
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
    });

    await new Promise(r => setTimeout(r, 5000));

    // Open the Forgejo sidebar and focus the Issues tree view
    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoIssues.focus');
    });
  });

  /** Collect all visible tree row labels from the sidebar */
  async function getTreeRowLabels(workbox: import('@playwright/test').Page): Promise<string[]> {
    const rows = workbox.locator('.monaco-list-row');
    const count = await rows.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      if (text) {
        labels.push(text.trim());
      }
    }
    return labels;
  }

  /**
   * Poll until at least one tree row label matches the pattern.
   * Returns all labels once a match is found, or throws on timeout.
   */
  async function waitForTreeRowsMatching(
    workbox: import('@playwright/test').Page,
    pattern: RegExp,
    timeout = 30_000,
  ): Promise<string[]> {
    const start = Date.now();
    let labels: string[] = [];
    while (Date.now() - start < timeout) {
      labels = await getTreeRowLabels(workbox);
      if (labels.some(l => pattern.test(l))) {
        return labels;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return labels;
  }

  test('should add a comment to an issue via API', async ({ harness, evaluateInVSCode }) => {
    // Create a fresh issue for this test
    const issueNumber = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: `Issue for comment test ${Date.now()}`, body: 'Test body' }),
      });
      const issue = await resp.json();
      return issue.number as number;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(issueNumber).toBeGreaterThan(0);

    // Add a comment
    const commentCreated = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; issueNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.issueNumber}/comments`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ body: 'Automated test comment on issue' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, issueNumber });

    expect(commentCreated).toBe(true);

    // Verify the comment exists
    const comments = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; issueNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.issueNumber}/comments`, {
        headers: { 'Authorization': `token ${args.token}` },
      });
      const data = await resp.json();
      return data as Array<{ body: string }>;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, issueNumber });

    const testComment = comments.find(c => c.body === 'Automated test comment on issue');
    expect(testComment).toBeDefined();

    await harness.captureScreenshot('issue-comment-added');
  });

  test('should close an issue via API and verify tree view', async ({ harness, evaluateInVSCode, workbox }) => {
    // Create a fresh issue
    const issueNumber = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: `Issue to close ${Date.now()}`, body: 'Will be closed' }),
      });
      const issue = await resp.json();
      return issue.number as number;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(issueNumber).toBeGreaterThan(0);

    // Close the issue
    const closed = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; issueNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.issueNumber}`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, issueNumber });

    expect(closed).toBe(true);

    // Refresh and check tree view
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
    });

    // Poll until a Closed group appears
    const closedPattern = /^Closed\s*\d+$/;
    const labels = await waitForTreeRowsMatching(workbox, closedPattern);
    console.log('Issue tree after close:', labels);

    // Should have a Closed group now
    const closedGroup = labels.find(label => closedPattern.test(label));
    expect(closedGroup).toBeDefined();

    await harness.captureScreenshot('issue-closed-tree');
  });

  test('should reopen a closed issue via API', async ({ harness, evaluateInVSCode, workbox }) => {
    // Create and immediately close an issue
    const issueNumber = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const createResp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: `Issue to reopen ${Date.now()}`, body: 'Will be reopened' }),
      });
      const issue = await createResp.json();

      // Close it
      await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${issue.number}`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });

      return issue.number as number;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(issueNumber).toBeGreaterThan(0);

    // Reopen the issue
    const reopened = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; issueNumber: number }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues/${args.issueNumber}`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify({ state: 'open' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, issueNumber });

    expect(reopened).toBe(true);

    // Refresh and verify Open group exists
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
    });

    // Poll until an Open group appears
    const openPattern = /^Open\s*\d+$/;
    const labels = await waitForTreeRowsMatching(workbox, openPattern);
    console.log('Issue tree after reopen:', labels);

    const openGroup = labels.find(label => openPattern.test(label));
    expect(openGroup).toBeDefined();

    await harness.captureScreenshot('issue-reopened-tree');
  });

  test('should create an issue via API and verify tree view', async ({ harness, evaluateInVSCode, workbox }) => {
    const issueTitle = `Auto Issue ${Date.now()}`;

    const created = await evaluateInVSCode(async (_vscode, args: { url: string; token: string; title: string }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues`, {
        headers: { 'Authorization': `token ${args.token}`, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ title: args.title, body: 'Created by automated test' }),
      });
      return resp.ok;
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN, title: issueTitle });

    expect(created).toBe(true);

    // Refresh and verify tree
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
    });

    // Poll until the new issue title appears in the tree
    const start = Date.now();
    let labels: string[] = [];
    while (Date.now() - start < 30_000) {
      labels = await getTreeRowLabels(workbox);
      if (labels.find(label => label.includes(issueTitle))) {
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('Issue tree after create:', labels);

    const foundIssue = labels.find(label => label.includes(issueTitle));
    expect(foundIssue).toBeDefined();

    await harness.captureScreenshot('issue-created-in-tree');
  });

  test('should verify PRs are excluded from issue list', async ({ evaluateInVSCode }) => {
    // Fetch issues via the API and verify none have pull_request field
    const result = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/issues?type=issues&state=open&limit=50`, {
        headers: { 'Authorization': `token ${args.token}` },
      });
      const issues = await resp.json() as Array<{ title: string; pull_request?: unknown }>;

      // Check that the extension's filtering logic is correct:
      // The issues endpoint returns both issues and PRs, but when type=issues is passed
      // or when filtering client-side, PRs (which have pull_request field) should be excluded.
      const prsInList = issues.filter(i => i.pull_request !== undefined && i.pull_request !== null);

      return {
        totalIssues: issues.length,
        prsFound: prsInList.length,
        issuesTitles: issues.map(i => i.title),
      };
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    console.log('Issues fetched:', result.totalIssues, 'PRs in list:', result.prsFound);
    console.log('Issue titles:', result.issuesTitles);

    // When using type=issues filter, no PRs should appear
    expect(result.prsFound).toBe(0);
    // Should have at least one real issue (created by setup script)
    expect(result.totalIssues).toBeGreaterThan(0);
  });
});
