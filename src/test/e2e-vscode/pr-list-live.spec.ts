import { test, expect } from './fixtures/vscode-harness';

/**
 * Live Playwright tests against a real Forgejo instance.
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

test.describe('Pull Request List - Live Forgejo', () => {
  test.skip(!shouldRun, 'Requires FORGEJO_LIVE_WORKSPACE, FORGEJO_TEST_URL, FORGEJO_TEST_TOKEN');

  // Use the pre-created git workspace so the extension detects the remote
  test.use({ baseDir: WORKSPACE || '/tmp' });

  test.setTimeout(60_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Configure the Forgejo instance with the test token
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

    // Refresh PRs now that an instance is configured
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });

    // Wait for the API call to complete
    await new Promise(r => setTimeout(r, 5000));

    // Open the Forgejo sidebar and focus the PR tree view
    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
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

  test('should display pull request groups', async ({ harness, workbox }) => {
    const firstRow = workbox.locator('.monaco-list-row').first();
    await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

    await harness.captureScreenshot('pr-list-live');

    const labels = await getTreeRowLabels(workbox);
    console.log('PR tree items:', labels);

    // The setup script creates one open PR, so we should see at least an "Open" group
    const prGroupPattern = /^(Open|Merged|Closed|Draft)\d+$/;
    const foundGroups = labels.filter(label => prGroupPattern.test(label));
    expect(foundGroups.length).toBeGreaterThan(0);
    console.log('PR groups found:', foundGroups);
  });

  test('should display the test PR entry', async ({ harness, workbox }) => {
    const firstRow = workbox.locator('.monaco-list-row').first();
    await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

    const labels = await getTreeRowLabels(workbox);

    // The setup script creates a PR titled "Test PR"
    const prEntries = labels.filter(label => /#\d+:/.test(label));
    expect(prEntries.length).toBeGreaterThan(0);

    const testPR = prEntries.find(label => label.includes('Test PR'));
    expect(testPR).toBeDefined();
    console.log('Found test PR:', testPR);

    await harness.captureScreenshot('pr-entry-live');
  });
});
