import * as vscode from 'vscode';
import { PRTreeProvider } from './providers/prTreeProvider';
import { IssueTreeProvider } from './providers/issueTreeProvider';
import { ActionsTreeProvider, WorkflowRunTreeItem, JobTreeItem } from './providers/actionsTreeProvider';
import { WorkflowRunListItem, WorkflowJob } from './models/action';
import { PRDiffContentProvider, PR_DIFF_SCHEME, createPRFileUri } from './providers/prDiffContentProvider';
import { PRDetailsContentProvider, PR_DETAILS_SCHEME } from './providers/prDetailsContentProvider';
import { PRDetailWebviewProvider } from './webview/prDetail/provider';
import { IssueDetailWebviewProvider } from './webview/issueDetail/provider';
import { ActionDetailWebviewProvider } from './webview/actionDetail/provider';
import { PullRequestFile, PullRequestListItem } from './models/pullRequest';
import { IssueListItem } from './models/issue';
import { setInstanceUrl, setAuthToken } from './utils/config';
import { migrateToMultiInstance } from './utils/migration';
import { getAllInstances } from './utils/instanceHelpers';
import { startOnboarding } from './commands/onboarding';
import { manageInstances } from './commands/instanceManager';
import { showDiagnostics } from './commands/diagnostics';
import { logger, logInfo, logError } from './utils/logger';
import { ForgejoClient } from './api/forgejoClient';
import { getForgejoConfig } from './utils/config';

export async function activate(context: vscode.ExtensionContext) {
  logInfo('Extension is now active');
  logInfo('VS Code version:', vscode.version);
  logInfo('Workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));

  // Migrate legacy config first (before creating tree providers)
  await migrateToMultiInstance();

  // Create tree data providers
  const prTreeProvider = new PRTreeProvider();
  const issueTreeProvider = new IssueTreeProvider();
  const actionsTreeProvider = new ActionsTreeProvider();

  // Check for first-time setup asynchronously (after tree providers are created)
  // This way the dialog doesn't block extension activation
  (async () => {
    const instances = await getAllInstances();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isTest = process.env.NODE_ENV === 'test' || typeof (global as any).it === 'function';

    if (instances.length === 0 && !isTest) {
      const action = await vscode.window.showInformationMessage(
        'Welcome to Forgejo! Configure your first instance to get started.',
        'Get Started',
        'Later'
      );

      if (action === 'Get Started') {
        const success = await vscode.commands.executeCommand('forgejo.addInstance');
        // Refresh tree providers after adding first instance
        if (success) {
          prTreeProvider.refresh();
          issueTreeProvider.refresh();
          actionsTreeProvider.refresh();
        }
      }
    }
  })();

  // Register tree views
  const prTreeView = vscode.window.createTreeView('forgejoPullRequests', {
    treeDataProvider: prTreeProvider,
    showCollapseAll: true
  });

  const issueTreeView = vscode.window.createTreeView('forgejoIssues', {
    treeDataProvider: issueTreeProvider,
    showCollapseAll: true
  });

  const actionsTreeView = vscode.window.createTreeView('forgejoActions', {
    treeDataProvider: actionsTreeProvider,
    showCollapseAll: true
  });

  // Create virtual document provider for PR diffs
  const prDiffProvider = new PRDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, prDiffProvider),
    prDiffProvider
  );

  // Create virtual document provider for PR details
  const prDetailsProvider = new PRDetailsContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DETAILS_SCHEME, prDetailsProvider),
    prDetailsProvider
  );

  // Register instance management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.addInstance', async () => {
      const success = await startOnboarding();
      if (success) {
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
        actionsTreeProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.manageInstances', async () => {
      await manageInstances();
      prTreeProvider.refresh();
      issueTreeProvider.refresh();
      actionsTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.showDiagnostics', async () => {
      await showDiagnostics();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.showOutput', () => {
      logger.show();
    })
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

  // Register create issue command
  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.createIssue', async () => {
      try {
        const config = await getForgejoConfig();
        if (!config) {
          vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
          return;
        }

        if (!config.token) {
          vscode.window.showErrorMessage('A Forgejo token is required to create issues. Please configure your token first.');
          return;
        }

        // Prompt for issue title
        const title = await vscode.window.showInputBox({
          prompt: 'Enter issue title',
          placeHolder: 'Issue title',
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Title is required';
            }
            return null;
          }
        });

        if (!title) {
          return; // User cancelled
        }

        // Prompt for issue body (optional)
        const body = await vscode.window.showInputBox({
          prompt: 'Enter issue description (optional)',
          placeHolder: 'Brief description (you can edit the full description in the browser after creation)'
        });

        if (body === undefined) {
          return; // User cancelled (pressing Escape)
        }

        // Create the issue
        const client = new ForgejoClient(config.instanceUrl, config.token);
        const issue = await client.createIssue(config.owner, config.repo, title.trim(), body?.trim() || undefined);

        logInfo(`Issue #${issue.number} created: ${issue.title}`);
        const action = await vscode.window.showInformationMessage(
          `Issue #${issue.number} created successfully!`,
          'Open in Browser'
        );

        if (action === 'Open in Browser') {
          vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        }

        // Refresh the issues tree to show the new issue
        issueTreeProvider.refresh();
      } catch (error) {
        logError('Error creating issue:', error);
        vscode.window.showErrorMessage(
          `Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forgejo.refreshActions', () => {
      actionsTreeProvider.refresh();
      vscode.window.showInformationMessage('Actions refreshed');
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
        // Refresh all views
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
        actionsTreeProvider.refresh();
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
        // Refresh all views
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
        actionsTreeProvider.refresh();
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
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              vscode.window.showInformationMessage(`File ${file.filename} was deleted in PR #${pr.number}`);
            }
            return;
          }

          // Handle added files (no "before" version)
          if (file.status === 'added') {
            const afterUri = createPRFileUri(owner, repo, headRef, file.filename);
            const doc = await vscode.workspace.openTextDocument(afterUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              vscode.window.showInformationMessage(`File ${file.filename} was added in PR #${pr.number}`);
            }
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

  // Register PR details viewer command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.showPrDetails',
      async (pr: PullRequestListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel
          await prDetailWebviewProvider.showPRDetails(owner, repo, pr.number);
        } catch (error) {
          console.error('[Forgejo] Error opening PR details:', error);
          vscode.window.showErrorMessage(
            `Failed to open PR details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register merge PR command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.mergePr',
      async (pr: PullRequestListItem, owner: string, repo: string) => {
        try {
          // Show merge method picker
          const mergeOptions = [
            { label: 'Create merge commit', value: 'merge' },
            { label: 'Squash and merge', value: 'squash' },
            { label: 'Rebase and merge', value: 'rebase' },
            { label: 'Rebase then merge', value: 'rebase-merge' },
            { label: 'Fast-forward only', value: 'fast-forward-only' }
          ];

          const selected = await vscode.window.showQuickPick(mergeOptions, {
            placeHolder: 'Select merge method'
          });

          if (!selected) {
            return; // User cancelled
          }

          // Confirm merge
          const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to merge PR #${pr.number}: "${pr.title}"?`,
            { modal: true },
            'Merge'
          );

          if (confirm !== 'Merge') {
            return;
          }

          // Execute merge
          const config = await getForgejoConfig();
          if (!config) {
            vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          const client = new ForgejoClient(config.instanceUrl, config.token);
          await client.mergePullRequest(owner, repo, pr.number, selected.value as any);

          vscode.window.showInformationMessage(`PR #${pr.number} merged successfully!`);
          prTreeProvider.refresh();
        } catch (error) {
          console.error('[Forgejo] Error merging PR:', error);
          vscode.window.showErrorMessage(
            `Failed to merge PR: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register close PR command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.closePr',
      async (pr: PullRequestListItem, owner: string, repo: string) => {
        try {
          // Confirm close
          const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to close PR #${pr.number}: "${pr.title}"?`,
            { modal: true },
            'Close PR'
          );

          if (confirm !== 'Close PR') {
            return;
          }

          // Execute close
          const config = await getForgejoConfig();
          if (!config) {
            vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          const client = new ForgejoClient(config.instanceUrl, config.token);
          await client.closePullRequest(owner, repo, pr.number);

          vscode.window.showInformationMessage(`PR #${pr.number} closed successfully!`);
          prTreeProvider.refresh();
        } catch (error) {
          console.error('[Forgejo] Error closing PR:', error);
          vscode.window.showErrorMessage(
            `Failed to close PR: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register Actions commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.openActionInBrowser',
      (item: WorkflowRunTreeItem | JobTreeItem) => {
        // Get the run data from either a run item or a job item
        const run = item instanceof WorkflowRunTreeItem ? item.jobs[0] : item.job;
        if (run && run.url) {
          vscode.env.openExternal(vscode.Uri.parse(run.url));
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.openActionInBrowserDirect',
      (url: string) => {
        if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.rerunAction',
      async (item: WorkflowRunTreeItem | JobTreeItem) => {
        // Get the run data from either a run item or a job item
        const run = item instanceof WorkflowRunTreeItem ? item.jobs[0] : item.job;
        if (!run) {
          return;
        }

        try {
          const confirm = await vscode.window.showWarningMessage(
            `Re-run workflow "${run.display_title || run.name}"?`,
            { modal: true },
            'Re-run'
          );

          if (confirm !== 'Re-run') {
            return;
          }

          const config = await getForgejoConfig();
          if (!config) {
            vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          const client = new ForgejoClient(config.instanceUrl, config.token);
          await client.rerunWorkflow(item.owner, item.repo, run.id);

          vscode.window.showInformationMessage('Workflow re-run triggered!');
          actionsTreeProvider.refresh();
        } catch (error) {
          console.error('[Forgejo] Error re-running workflow:', error);
          vscode.window.showErrorMessage(
            `Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register Action details viewer command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.showActionDetails',
      async (run: WorkflowRunListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel with the run data we already have
          await actionDetailWebviewProvider.showActionDetails(owner, repo, run);
        } catch (error) {
          console.error('[Forgejo] Error opening Action details:', error);
          vscode.window.showErrorMessage(
            `Failed to open Action details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.viewActionLogs',
      async (run: WorkflowRunListItem, job: WorkflowJob, owner: string, repo: string) => {
        try {
          const config = await getForgejoConfig();
          if (!config) {
            vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching logs for ${job.name}...`,
              cancellable: false
            },
            async () => {
              const client = new ForgejoClient(config.instanceUrl, config.token);
              // Find the job index (position in the jobs array)
              const jobsResponse = await client.getWorkflowJobs(owner, repo, run.id);
              const jobIndex = jobsResponse.jobs.findIndex(j => j.id === job.id);

              const logs = await client.getWorkflowLogs(owner, repo, run.run_number, jobIndex >= 0 ? jobIndex : 0);

              // Create a new untitled document with the logs
              const doc = await vscode.workspace.openTextDocument({
                content: logs,
                language: 'log'
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            }
          );
        } catch (error) {
          console.error('[Forgejo] Error fetching logs:', error);
          vscode.window.showErrorMessage(
            `Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Add tree views to subscriptions
  context.subscriptions.push(prTreeView);
  context.subscriptions.push(issueTreeView);
  context.subscriptions.push(actionsTreeView);

  // Create PR detail webview provider (not registered as WebviewViewProvider since we use WebviewPanel)
  const prDetailWebviewProvider = new PRDetailWebviewProvider(context.extensionUri);

  // Create Issue detail webview provider
  const issueDetailWebviewProvider = new IssueDetailWebviewProvider(context.extensionUri);

  // Create Action detail webview provider
  const actionDetailWebviewProvider = new ActionDetailWebviewProvider(context.extensionUri);

  // Register Issue details viewer command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.showIssueDetails',
      async (issue: IssueListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel
          await issueDetailWebviewProvider.showIssueDetails(owner, repo, issue.number);
        } catch (error) {
          console.error('[Forgejo] Error opening Issue details:', error);
          vscode.window.showErrorMessage(
            `Failed to open Issue details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register open issue in browser from context menu command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'forgejo.openIssueInBrowserFromContext',
      (issueItem: unknown) => {
        if (issueItem && typeof issueItem === 'object' && 'htmlUrl' in issueItem && typeof issueItem.htmlUrl === 'string') {
          vscode.env.openExternal(vscode.Uri.parse(issueItem.htmlUrl));
        }
      }
    )
  );

  // Add logger to subscriptions for proper cleanup
  context.subscriptions.push(logger);

  logInfo('Extension activation complete');
}

export function deactivate() {
  logInfo('Extension is now deactivated');
}
