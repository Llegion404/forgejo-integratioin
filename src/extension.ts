import * as vscode from 'vscode';
import { PRTreeProvider } from './providers/prTreeProvider';
import { IssueTreeProvider } from './providers/issueTreeProvider';
import { PRDiffContentProvider, PR_DIFF_SCHEME, createPRFileUri } from './providers/prDiffContentProvider';
import { PullRequestFile, PullRequestListItem } from './models/pullRequest';
import { setInstanceUrl, setAuthToken } from './utils/config';

export function activate(context: vscode.ExtensionContext) {
  console.log('[Forgejo] Extension is now active');
  console.log('[Forgejo] VS Code version:', vscode.version);
  console.log('[Forgejo] Workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));

  // Create tree data providers
  const prTreeProvider = new PRTreeProvider();
  const issueTreeProvider = new IssueTreeProvider();

  // Register tree views
  const prTreeView = vscode.window.createTreeView('forgejoPullRequests', {
    treeDataProvider: prTreeProvider,
    showCollapseAll: true
  });

  const issueTreeView = vscode.window.createTreeView('forgejoIssues', {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true
  });

  // Create virtual document provider for PR diffs
  const prDiffProvider = new PRDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, prDiffProvider)
  );

  // Register refresh commands
  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.refreshPullRequests', () => {
      prTreeProvider.refresh();
      vscode.window.showInformationMessage('Pull Requests refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.refreshIssues', () => {
      issueTreeProvider.refresh();
      vscode.window.showInformationMessage('Issues refreshed');
    })
  );

  // Register configuration commands
  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.configureInstanceUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter Forgejo instance URL',
        placeHolder: 'https://codeberg.org',
        validateInput: (value) => {
          if (!value) {
            return 'URL is required';
          }
          try {
            new URL(value);
            return null;
          } catch {
            return 'Invalid URL format';
          }
        }
      });

      if (url) {
        await setInstanceUrl(url);
        vscode.window.showInformationMessage(`Forgejo instance URL set to: ${url}`);
        // Refresh both views
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.setAuthToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Forgejo personal access token',
        placeHolder: 'token_xxxxxxxxxxxxxx',
        password: true,
        validateInput: (value) => {
          if (!value) {
            return 'Token is required';
          }
          return null;
        }
      });

      if (token) {
        await setAuthToken(token);
        vscode.window.showInformationMessage('Forgejo authentication token saved');
        // Refresh both views
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
      }
    })
  );

  // Register open in browser commands
  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.openPrInBrowser', (url: string) => {
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.openIssueInBrowser', (url: string) => {
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  // Register PR file diff viewer
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.showPrFileDiff',
      async (
        file: PullRequestFile,
        pr: PullRequestListItem,
        owner: string,
        repo: string,
        baseRef: string,
        headRef: string
      ) => {
        console.log('[Forgejo] Opening diff for file:', file.filename);

        try {
          // Handle deleted files (no "after" version)
          if (file.status === 'removed') {
            const beforeUri = createPRFileUri(owner, repo, baseRef, file.filename);
            const doc = await vscode.workspace.openTextDocument(beforeUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            vscode.window.showInformationMessage(`File ${file.filename} was deleted in PR #${pr.number}`);
            return;
          }

          // Handle added files (no "before" version)
          if (file.status === 'added') {
            const afterUri = createPRFileUri(owner, repo, headRef, file.filename);
            const doc = await vscode.workspace.openTextDocument(afterUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            vscode.window.showInformationMessage(`File ${file.filename} was added in PR #${pr.number}`);
            return;
          }

          // For modified/renamed files, show diff
          const beforePath = file.previous_filename || file.filename;
          const afterPath = file.filename;

          const beforeUri = createPRFileUri(owner, repo, baseRef, beforePath);
          const afterUri = createPRFileUri(owner, repo, headRef, afterPath);

          const title = `PR #${pr.number}: ${file.filename}`;

          // Open VS Code's native diff viewer
          await vscode.commands.executeCommand(
            'vscode.diff',
            beforeUri,
            afterUri,
            title,
            { preview: true }
          );

          console.log('[Forgejo] Diff opened successfully');
        } catch (error) {
          console.error('[Forgejo] Error opening diff:', error);
          vscode.window.showErrorMessage(
            `Failed to open diff: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Add context menu command to open PR in browser
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.openPrInBrowserFromContext',
      (prItem: unknown) => {
        if (prItem && typeof prItem === 'object' && 'htmlUrl' in prItem && typeof prItem.htmlUrl === 'string') {
          vscode.env.openExternal(vscode.Uri.parse(prItem.htmlUrl));
        }
      }
    )
  );

  // Add context menu command to open file in browser
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.openPrFileInBrowser',
      (fileItem: unknown) => {
        if (fileItem && typeof fileItem === 'object' && 'file' in fileItem && fileItem.file && typeof fileItem.file === 'object' && 'blob_url' in fileItem.file && typeof fileItem.file.blob_url === 'string') {
          vscode.env.openExternal(vscode.Uri.parse(fileItem.file.blob_url));
        }
      }
    )
  );

  // Add tree views to subscriptions
  context.subscriptions.push(prTreeView);
  context.subscriptions.push(issueTreeView);

  // Show welcome message
  vscode.window.showInformationMessage('Forgejo extension activated! Configure your instance URL to get started.');
}

export function deactivate() {
  console.log('Forgejo extension is now deactivated');
}
