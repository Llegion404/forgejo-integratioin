import { test, expect } from './fixtures/vscode-harness';

/**
 * Live e2e test that simulates a user clicking through the PR tree view
 * to open a file diff — the same way a real user would.
 *
 * Flow:
 *   1. Open the Forgejo sidebar
 *   2. Expand the "Open" group in the PR tree
 *   3. Click on a PR to expand it and load its files
 *   4. Click on a file to open the diff
 *   5. Verify the diff editor opens with real file content
 *   6. Verify the URI uses the new base64url format (no query params)
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

test.describe('PR Diff via Sidebar Click - Live Forgejo', () => {
  test.skip(!shouldRun, 'Requires FORGEJO_LIVE_WORKSPACE, FORGEJO_TEST_URL, FORGEJO_TEST_TOKEN');

  test.use({ baseDir: WORKSPACE || '/tmp' });

  test.setTimeout(90_000);

  test.beforeEach(async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    // Configure the local test Forgejo instance
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

    // Refresh PRs
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });
    await new Promise(r => setTimeout(r, 5000));

    // Open Forgejo sidebar and focus PR tree
    await harness.openForgejoSidebar();
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejoPullRequests.focus');
    });
  });

  /** Get all visible tree row labels */
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

  test('click through sidebar to open PR file diff', async ({ harness, evaluateInVSCode, workbox }) => {
    // Step 1: Wait for the tree to load
    const firstRow = workbox.locator('.monaco-list-row').first();
    await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

    await harness.captureScreenshot('01-pr-tree-loaded');

    let labels = await getTreeRowLabels(workbox);
    console.log('Initial tree items:', labels);

    // Step 2: Find and click on the "Merged" or "Closed" group to expand it
    // (these groups start collapsed by default)
    const mergedRow = workbox.locator('.monaco-list-row', {
      hasText: /^Merged/,
    }).first();
    const closedRow = workbox.locator('.monaco-list-row', {
      hasText: /^Closed/,
    }).first();

    // Try Merged first, fall back to Closed
    const mergedCount = await mergedRow.count();
    const closedCount = await closedRow.count();

    if (mergedCount > 0) {
      console.log('Clicking on Merged group to expand...');
      await mergedRow.click();
    } else if (closedCount > 0) {
      console.log('Clicking on Closed group to expand...');
      await closedRow.click();
    } else {
      // If neither exists, try Open (which should already be expanded)
      console.log('No Merged/Closed group, using already-expanded Open group');
    }

    await new Promise(r => setTimeout(r, 2000));
    await harness.captureScreenshot('02-group-expanded');

    labels = await getTreeRowLabels(workbox);
    console.log('After expanding group:', labels);

    // Step 3: Find a PR entry (format: "#N: Title by user")
    const prRow = workbox.locator('.monaco-list-row', {
      hasText: /#\d+:/,
    }).first();
    await prRow.waitFor({ state: 'visible', timeout: 10_000 });

    const prText = await prRow.textContent();
    console.log('Found PR:', prText?.trim());

    // Click on the PR to expand it and load files
    await prRow.click();
    console.log('Clicked on PR to expand...');

    // Wait for files to load (API call + tree update)
    await new Promise(r => setTimeout(r, 5000));
    await harness.captureScreenshot('03-pr-expanded');

    labels = await getTreeRowLabels(workbox);
    console.log('After expanding PR:', labels);

    // Step 4: Find a file item (look for items with +N -N pattern in description)
    // File items have format: "filename +N -N" or just the filename
    // They appear as children after the PR item
    const fileRow = workbox.locator('.monaco-list-row', {
      hasText: /\+\d+\s+-\d+/,
    }).first();

    const fileRowExists = await fileRow.count();
    if (fileRowExists === 0) {
      // Maybe files don't have the +/- pattern visible, try clicking
      // a row that looks like a file path (contains a dot extension)
      console.log('No +/- pattern found, looking for file-like entries...');
      const anyFileRow = workbox.locator('.monaco-list-row', {
        hasText: /\.\w+$/,
      }).first();
      const anyFileExists = await anyFileRow.count();
      expect(anyFileExists).toBeGreaterThan(0);
      const fileName = await anyFileRow.textContent();
      console.log('Clicking on file:', fileName?.trim());
      await anyFileRow.click();
    } else {
      const fileName = await fileRow.textContent();
      console.log('Clicking on file:', fileName?.trim());
      await fileRow.click();
    }

    // Wait for the diff to open and content to load
    await new Promise(r => setTimeout(r, 5000));
    await harness.captureScreenshot('04-diff-opened');

    // Step 5: Verify the diff editor opened with real content
    const editorInfo = await evaluateInVSCode(async (vscode) => {
      // Check all visible editors with forgejo-pr scheme
      const editors = vscode.window.visibleTextEditors.filter(
        e => e.document.uri.scheme === 'forgejo-pr'
      );

      // Also check the active editor
      const ae = vscode.window.activeTextEditor;
      if (ae && ae.document.uri.scheme === 'forgejo-pr' &&
          !editors.find(e => e.document.uri.toString() === ae.document.uri.toString())) {
        editors.push(ae);
      }

      // Check tabs for diff editors (which have original + modified URIs)
      const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      const prTabs = allTabs.filter(t => {
        const input = t.input as any;
        return input?.uri?.scheme === 'forgejo-pr' ||
               input?.modified?.scheme === 'forgejo-pr' ||
               input?.original?.scheme === 'forgejo-pr';
      }).map(t => {
        const input = t.input as any;
        // Diff tabs have original + modified; single file tabs have uri
        const uris: Array<{ path: string; query: string; scheme: string; full: string }> = [];
        for (const key of ['uri', 'original', 'modified']) {
          const u = input?.[key];
          if (u?.scheme === 'forgejo-pr') {
            uris.push({
              path: u.path,
              query: u.query || '',
              scheme: u.scheme,
              full: u.toString(),
            });
          }
        }
        return { label: t.label, uris };
      });

      return {
        editorCount: editors.length,
        editors: editors.map(e => ({
          uriScheme: e.document.uri.scheme,
          uriPath: e.document.uri.path,
          uriQuery: e.document.uri.query,
          contentLength: e.document.getText().length,
          contentSnippet: e.document.getText().substring(0, 300),
          hasError: e.document.getText().startsWith('// Error:'),
          hasRestoreMsg: e.document.getText().includes('could not be restored'),
        })),
        tabs: prTabs,
      };
    });

    console.log('Editor info:', JSON.stringify(editorInfo, null, 2));

    // At least one editor or tab should have the forgejo-pr scheme
    const totalPrViews = editorInfo.editorCount + editorInfo.tabs.length;
    expect(totalPrViews).toBeGreaterThan(0);

    // Verify editors have content (not error/restore messages)
    for (const editor of editorInfo.editors) {
      expect(editor.uriScheme).toBe('forgejo-pr');
      expect(editor.uriQuery).toBe('');
      expect(editor.hasRestoreMsg).toBe(false);
      expect(editor.contentLength).toBeGreaterThan(0);
      console.log(`Editor (${editor.contentLength} chars): ${editor.contentSnippet.substring(0, 100)}...`);
    }

    // Verify all tab URIs use base64url format (no query params)
    for (const tab of editorInfo.tabs) {
      console.log(`Tab "${tab.label}":`, tab.uris.map(u => u.full));
      for (const uri of tab.uris) {
        expect(uri.query).toBe('');
        expect(uri.scheme).toBe('forgejo-pr');

        // Verify path has at least 4 segments: owner/repo/base64ref/filepath
        const parts = uri.path.split('/').filter((p: string) => p);
        expect(parts.length).toBeGreaterThanOrEqual(4);

        // Third segment should base64url-decode to a valid ref
        const decodedRef = Buffer.from(parts[2], 'base64url').toString();
        expect(decodedRef.length).toBeGreaterThan(0);
        console.log(`  URI ref: "${decodedRef}" (encoded: ${parts[2]})`);
      }
    }
  });
});
