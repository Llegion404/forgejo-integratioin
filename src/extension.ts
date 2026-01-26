import * as vscode from 'vscode';
import { PRTreeProvider } from './providers/prTreeProvider';
import { IssueTreeProvider } from './providers/issueTreeProvider';
import { setInstanceUrl, setAuthToken } from './utils/config';

export function activate(context: vscode.ExtensionContext) {
  console.log('Forgejo extension is now active');

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

  // Add tree views to subscriptions
  context.subscriptions.push(prTreeView);
  context.subscriptions.push(issueTreeView);

  // Show welcome message
  vscode.window.showInformationMessage('Forgejo extension activated! Configure your instance URL to get started.');
}

export function deactivate() {
  console.log('Forgejo extension is now deactivated');
}
