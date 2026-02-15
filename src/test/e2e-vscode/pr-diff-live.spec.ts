import { test, expect } from './fixtures/vscode-harness';

/**
 * Live Playwright tests for PR diff viewing.
 *
 * Uses a local test Forgejo instance (testuser/test-repo)
 * to test that PR diffs actually render file content and that URIs survive
 * tab serialization (base64url-encoded ref, no query params).
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

test.describe('PR Diff Viewer - Live Forgejo', () => {
  test.skip(!shouldRun, 'Requires FORGEJO_LIVE_WORKSPACE, FORGEJO_TEST_URL, FORGEJO_TEST_TOKEN');

  // Use the pre-created test workspace
  test.use({ baseDir: WORKSPACE || '/tmp' });

  test.setTimeout(60_000);

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

    // Refresh PRs so the extension fetches data
    await evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
    });
    await new Promise(r => setTimeout(r, 5000));
  });

  test('should open a real PR file diff and display content', async ({ harness, evaluateInVSCode }) => {
    // Use the Forgejo API to find a merged PR with files
    const prInfo = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      // Fetch a recent PR that has files from the test instance
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls?state=all&limit=5`, {
        headers: { 'Authorization': `token ${args.token}` },
      });
      const prs = await resp.json() as Array<{
        number: number; title: string; state: string; merged: boolean;
        head: { ref: string }; base: { ref: string };
      }>;

      // Pick any PR (test repo should have at least one)
      const pr = prs[0];
      if (!pr) { return null; }

      // Fetch the PR's files
      const filesResp = await fetch(
        `${args.url}/api/v1/repos/testuser/test-repo/pulls/${pr.number}/files`,
        { headers: { 'Authorization': `token ${args.token}` } }
      );
      const files = await filesResp.json() as Array<{
        filename: string; status: string; additions: number; deletions: number; changes: number;
      }>;

      // Pick a file (test repo should have files)
      const targetFile = files[0];

      return {
        number: pr.number,
        title: pr.title,
        headRef: pr.head.ref,
        baseRef: pr.base.ref,
        file: targetFile ? {
          filename: targetFile.filename,
          status: targetFile.status,
          additions: targetFile.additions,
          deletions: targetFile.deletions,
          changes: targetFile.changes,
        } : null,
      };
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    console.log('PR info:', JSON.stringify(prInfo, null, 2));
    expect(prInfo).not.toBeNull();
    expect(prInfo!.file).not.toBeNull();

    // Open the diff via the extension command
    const diffResult = await evaluateInVSCode(async (vscode, args: {
      prNumber: number; prTitle: string; headRef: string; baseRef: string;
      file: { filename: string; status: string; additions: number; deletions: number; changes: number };
    }) => {
      const file = {
        filename: args.file.filename,
        status: args.file.status as 'added' | 'modified' | 'removed' | 'renamed',
        additions: args.file.additions,
        deletions: args.file.deletions,
        changes: args.file.changes,
        blob_url: '',
        raw_url: '',
        contents_url: '',
      };
      const pr = {
        number: args.prNumber,
        title: args.prTitle,
        state: 'closed' as const,
        user: { login: 'maxking' },
        html_url: '',
        created_at: new Date().toISOString(),
        merged: true,
        draft: false,
        comments: 0,
      };

      try {
        await vscode.commands.executeCommand(
          'forgejo.showPrFileDiff',
          file, pr,
          'maxking', 'forgejo-vscode',
          args.baseRef, args.headRef
        );
        // Wait for content to load from API
        await new Promise(r => setTimeout(r, 5000));

        // Check the active editor — for added files, it's a single editor;
        // for modified, it's a diff editor and activeTextEditor may point to
        // either side. Check all visible editors.
        const editors = vscode.window.visibleTextEditors.filter(
          e => e.document.uri.scheme === 'forgejo-pr'
        );

        if (editors.length === 0) {
          // Diff editor: activeTextEditor might still have it
          const ae = vscode.window.activeTextEditor;
          if (ae && ae.document.uri.scheme === 'forgejo-pr') {
            editors.push(ae);
          }
        }

        return {
          opened: true,
          editorCount: editors.length,
          editors: editors.map(e => ({
            uriString: e.document.uri.toString(),
            uriScheme: e.document.uri.scheme,
            uriPath: e.document.uri.path,
            uriQuery: e.document.uri.query,
            contentLength: e.document.getText().length,
            contentSnippet: e.document.getText().substring(0, 200),
            hasError: e.document.getText().startsWith('// Error:'),
            hasRestoreMessage: e.document.getText().includes('could not be restored'),
          })),
        };
      } catch (e: any) {
        return { opened: false, editorCount: 0, editors: [], error: e.message };
      }
    }, {
      prNumber: prInfo!.number,
      prTitle: prInfo!.title,
      headRef: prInfo!.headRef,
      baseRef: prInfo!.baseRef,
      file: prInfo!.file!,
    });

    console.log('Diff result:', JSON.stringify(diffResult, null, 2));

    expect(diffResult.opened).toBe(true);
    expect(diffResult.editorCount).toBeGreaterThan(0);

    for (const editor of diffResult.editors) {
      // URI format: no query params, base64url ref in path
      expect(editor.uriScheme).toBe('forgejo-pr');
      expect(editor.uriQuery).toBe('');

      // Content should NOT be the "could not be restored" fallback
      expect(editor.hasRestoreMessage).toBe(false);

      // Content should have loaded (non-trivial length)
      expect(editor.contentLength).toBeGreaterThan(0);

      // Content should NOT be an error (if API is reachable)
      if (editor.hasError) {
        console.warn('Editor has error content:', editor.contentSnippet);
      }

      console.log(`Editor content (${editor.contentLength} chars): ${editor.contentSnippet}`);
    }

    await harness.captureScreenshot('pr-diff-content-live');
  });

  test('PR diff tab has base64url-encoded ref in URI path', async ({ harness, evaluateInVSCode }) => {
    // Fetch a PR to get its refs
    const prInfo = await evaluateInVSCode(async (_vscode, args: { url: string; token: string }) => {
      const resp = await fetch(`${args.url}/api/v1/repos/testuser/test-repo/pulls?state=all&limit=1`, {
        headers: { 'Authorization': `token ${args.token}` },
      });
      const prs = await resp.json() as Array<{
        number: number; title: string;
        head: { ref: string }; base: { ref: string };
      }>;
      if (!prs.length) { return null; }

      const filesResp = await fetch(
        `${args.url}/api/v1/repos/testuser/test-repo/pulls/${prs[0].number}/files?limit=1`,
        { headers: { 'Authorization': `token ${args.token}` } }
      );
      const files = await filesResp.json() as Array<{ filename: string; status: string }>;

      return {
        number: prs[0].number,
        title: prs[0].title,
        headRef: prs[0].head.ref,
        baseRef: prs[0].base.ref,
        file: files[0],
      };
    }, { url: FORGEJO_URL, token: FORGEJO_TOKEN });

    expect(prInfo).not.toBeNull();

    // Open the file
    await evaluateInVSCode(async (vscode, args: {
      prNumber: number; headRef: string; baseRef: string;
      file: { filename: string; status: string };
    }) => {
      const file = {
        filename: args.file.filename,
        status: (args.file.status || 'added') as any,
        additions: 1, deletions: 0, changes: 1,
        blob_url: '', raw_url: '', contents_url: '',
      };
      const pr = {
        number: args.prNumber, title: 'Test',
        state: 'closed' as const,
        user: { login: 'maxking' }, html_url: '',
        created_at: new Date().toISOString(),
        merged: true, draft: false, comments: 0,
      };
      await vscode.commands.executeCommand(
        'forgejo.showPrFileDiff',
        file, pr, 'maxking', 'forgejo-vscode',
        args.baseRef, args.headRef
      );
      await new Promise(r => setTimeout(r, 3000));
    }, {
      prNumber: prInfo!.number,
      headRef: prInfo!.headRef,
      baseRef: prInfo!.baseRef,
      file: prInfo!.file,
    });

    // Inspect all open tabs
    const tabs = await evaluateInVSCode(async (vscode) => {
      const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      return allTabs
        .filter(t => {
          const input = t.input as any;
          return input?.uri?.scheme === 'forgejo-pr' ||
                 input?.modified?.scheme === 'forgejo-pr' ||
                 input?.original?.scheme === 'forgejo-pr';
        })
        .map(t => {
          const input = t.input as any;
          const uri = input?.uri || input?.modified || input?.original;
          return {
            label: t.label,
            scheme: uri?.scheme || '',
            path: uri?.path || '',
            query: uri?.query || '',
          };
        });
    });

    console.log('Tabs:', JSON.stringify(tabs, null, 2));
    expect(tabs.length).toBeGreaterThan(0);

    for (const tab of tabs) {
      expect(tab.query).toBe('');
      expect(tab.scheme).toBe('forgejo-pr');

      // Decode the base64url ref segment
      const parts = tab.path.split('/').filter((p: string) => p);
      expect(parts.length).toBeGreaterThanOrEqual(4);

      const decodedRef = Buffer.from(parts[2], 'base64url').toString();
      console.log(`Tab "${tab.label}": ref="${decodedRef}"`);
      expect(decodedRef.length).toBeGreaterThan(0);
      // The decoded ref should match either the head or base ref
      expect([prInfo!.headRef, prInfo!.baseRef]).toContain(decodedRef);
    }

    await harness.captureScreenshot('pr-diff-tab-uri-check');
  });
});
