import { test, expect } from './fixtures/vscode-harness';
import path from 'path';

// Open VS Code with the project root as workspace so git remote is detected
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('Pull Request List', () => {
  test.use({ baseDir: PROJECT_ROOT });

  // These tests make real API calls to the Forgejo instance
  test.setTimeout(60_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Configure the Forgejo instance matching the git remote (no token needed for public repos)
    await evaluateInVSCode(async (vscode) => {
      const config = vscode.workspace.getConfiguration('forgejo');
      await config.update('instances', [{
        id: 'test-forgejo',
        name: 'Forgejo',
        instanceUrl: 'https://git.araj.me',
        token: '',
        isDefault: true,
      }], vscode.ConfigurationTarget.Global);
    });

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

  test('should display pull request groups with counts', async ({ harness, workbox }) => {
    // Wait for tree rows to appear
    const firstRow = workbox.locator('.monaco-list-row').first();
    await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

    await harness.captureScreenshot('pr-list');

    const labels = await getTreeRowLabels(workbox);
    console.log('PR tree items:', labels);

    // The tree should show at least one PR state group (Open, Merged, Closed, Draft)
    // Group labels include the count suffix, e.g. "Open4" or "Merged26"
    const prGroupPattern = /^(Open|Merged|Closed|Draft)\d+$/;
    const foundGroups = labels.filter(label => prGroupPattern.test(label));
    expect(foundGroups.length).toBeGreaterThan(0);

    // Each group should report at least 1 PR
    for (const group of foundGroups) {
      const count = parseInt(group.replace(/^(Open|Merged|Closed|Draft)/, ''), 10);
      expect(count).toBeGreaterThan(0);
    }

    console.log('PR groups found:', foundGroups);
  });
});
