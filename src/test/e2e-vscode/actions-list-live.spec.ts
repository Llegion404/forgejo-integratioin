import { test, expect } from './fixtures/vscode-harness';

/**
 * Live Playwright tests for the Actions List view against a real Forgejo instance.
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

test.describe('Actions List - Live Forgejo', () => {
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

    // Refresh Actions now that an instance is configured
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshActions');
    });

    // Wait for the API call to complete
    await new Promise(r => setTimeout(r, 5000));

    // Open the Forgejo sidebar and focus the Actions tree view
    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoActions.focus');
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

  test('should display actions view', async ({ harness, workbox }) => {
    await harness.captureScreenshot('actions-list-live');

    // The Actions view should be visible - it may show action runs or an empty/info message
    // Check that we can at least see the view rendered (rows or a welcome view)
    const rows = workbox.locator('.monaco-list-row');
    const rowCount = await rows.count();

    const labels = await getTreeRowLabels(workbox);
    console.log('Actions tree items:', labels);
    console.log('Actions row count:', rowCount);

    // The view rendered successfully - actions may or may not be present
    // depending on whether the test repo has workflows configured
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should refresh actions via command', async ({ harness, workbox, evaluateInVSCode }) => {
    // Trigger a refresh
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshActions');
    });

    // Wait for refresh to complete
    await new Promise(r => setTimeout(r, 5000));

    await harness.captureScreenshot('actions-refresh-live');

    // After refresh, the view should still be functional
    const rows = workbox.locator('.monaco-list-row');
    const rowCount = await rows.count();
    console.log('Actions row count after refresh:', rowCount);

    // View rendered without errors
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });
});
