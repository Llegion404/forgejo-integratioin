import { test, expect } from './fixtures/vscode-harness';

test.describe('PR Diff Tab Restoration', () => {

  test('createPRFileUri encodes ref as base64url in path (no query params)', async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    const uriInfo = await evaluateInVSCode(async (vscode) => {
      const ref = 'refs/pull/49/head';
      const owner = 'maxking';
      const repo = 'forgejo-vscode';
      const filepath = 'src/test/e2e-vscode/issue-list-live.spec.ts';

      // Buffer is a Node.js global, no require needed
      const encodedRef = Buffer.from(ref).toString('base64url');
      const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
      const path = `/${owner}/${repo}/${encodedRef}/${encodedPath}`;
      const uri = vscode.Uri.parse(`forgejo-pr:${path}`);

      return {
        scheme: uri.scheme,
        path: uri.path,
        query: uri.query,
        uriString: uri.toString(),
        encodedRef,
        decodedRef: Buffer.from(encodedRef, 'base64url').toString(),
      };
    });

    expect(uriInfo.scheme).toBe('forgejo-pr');
    expect(uriInfo.query).toBe('');
    expect(uriInfo.path).toContain(uriInfo.encodedRef);
    expect(uriInfo.decodedRef).toBe('refs/pull/49/head');
    // Path should NOT contain the raw ref with slashes
    expect(uriInfo.path).not.toContain('refs/pull/49/head');

    console.log('URI string:', uriInfo.uriString);
    console.log('Encoded ref:', uriInfo.encodedRef);
  });

  test('PR diff virtual document opens with base64url ref in URI', async ({ harness, evaluateInVSCode }) => {
    await harness.waitForExtensionActivation();

    const openResult = await evaluateInVSCode(async (vscode) => {
      const ref = 'feature/test-branch';
      const owner = 'testowner';
      const repo = 'testrepo';
      const filepath = 'src/file.ts';

      const encodedRef = Buffer.from(ref).toString('base64url');
      const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
      const path = `/${owner}/${repo}/${encodedRef}/${encodedPath}`;
      const uri = vscode.Uri.parse(`forgejo-pr:${path}`);

      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        return {
          opened: true,
          uriString: uri.toString(),
          docUri: doc.uri.toString(),
          uriPath: uri.path,
          uriQuery: uri.query,
        };
      } catch (e: any) {
        return {
          opened: false,
          uriString: uri.toString(),
          error: e.message,
          uriPath: uri.path,
          uriQuery: uri.query,
        };
      }
    });

    console.log('Open result:', JSON.stringify(openResult, null, 2));

    // The URI should have no query parameters
    expect(openResult.uriQuery).toBe('');
    expect(openResult.uriPath).toContain('testowner/testrepo/');
    // Path should NOT contain the raw branch name with slashes
    expect(openResult.uriPath).not.toContain('feature/test-branch');

    // Check what VS Code's tab API reports
    const tabInfo = await evaluateInVSCode(async (vscode) => {
      const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
      const prTabs = tabs.filter(t => {
        const input = t.input as any;
        return input?.uri?.scheme === 'forgejo-pr' ||
               input?.modified?.scheme === 'forgejo-pr' ||
               input?.original?.scheme === 'forgejo-pr';
      });

      return prTabs.map(t => {
        const input = t.input as any;
        const uri = input?.uri || input?.modified || input?.original;
        return {
          label: t.label,
          uriString: uri?.toString?.() || 'unknown',
          uriPath: uri?.path || 'unknown',
          uriQuery: uri?.query || '',
        };
      });
    });

    console.log('PR tabs:', JSON.stringify(tabInfo, null, 2));

    if (tabInfo.length > 0) {
      for (const tab of tabInfo) {
        expect(tab.uriQuery).toBe('');
        expect(tab.uriPath).not.toContain('feature/test-branch');
      }
    }

    await harness.captureScreenshot('pr-diff-tab-opened');
  });
});
