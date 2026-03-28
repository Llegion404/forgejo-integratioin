import * as vscode from 'vscode';
import { PRTreeProvider } from './providers/prTreeProvider';
import { IssueTreeProvider } from './providers/issueTreeProvider';
import { ActionsTreeProvider, WorkflowRunTreeItem, JobTreeItem, StepTreeItem, StepLogArgs } from './providers/actionsTreeProvider';
import { ReleaseTreeProvider } from './providers/releaseTreeProvider';
import { WorkflowRunListItem, WorkflowJob } from './models/action';
import { PRDiffContentProvider, PR_DIFF_SCHEME, createPRFileUri } from './providers/prDiffContentProvider';
import { PRDetailsContentProvider, PR_DETAILS_SCHEME } from './providers/prDetailsContentProvider';
import { PRDetailWebviewProvider } from './webview/prDetail/provider';
import { IssueDetailWebviewProvider } from './webview/issueDetail/provider';
import { ActionDetailWebviewProvider } from './webview/actionDetail/provider';
import { ForgejoCommentController } from './providers/prCommentController';
import { PullRequestFile, PullRequestListItem } from './models/pullRequest';
import { IssueListItem } from './models/issue';
import { configureInstanceUrlCommand, setAuthTokenCommand } from './commands/legacyConfig';
import { migrateToMultiInstance } from './utils/migration';
import { getAllInstances } from './utils/instanceHelpers';
import { startOnboarding } from './commands/onboarding';
import { manageInstances } from './commands/instanceManager';
import { showDiagnostics } from './commands/diagnostics';
import { createIssueCommand } from './commands/createIssue';
import { createPullRequestCommand } from './commands/createPullRequest';
import { createReleaseCommand } from './commands/createRelease';
import { mergePrCommand } from './commands/mergePr';
import { selectRemoteCommand } from './commands/selectRemote';
import { closePrCommand } from './commands/closePr';
import { registerCommand } from './commands/registry';
import { logger, logInfo } from './utils/logger';
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
  const releaseTreeProvider = new ReleaseTreeProvider();

  // Helper to update the context key for viewsWelcome
  async function updateNoInstanceContext() {
    const instances = await getAllInstances();
    const config = await getForgejoConfig();
    // Show welcome content only when no instances AND no usable git remote
    await vscode.commands.executeCommand('setContext', 'forgejo.noInstanceConfigured', instances.length === 0 && !config);
    return instances;
  }

  // Set initial context and check for first-time setup
  void (async () => {
    const instances = await updateNoInstanceContext();
    const isTest = process.env.NODE_ENV === 'test' || typeof (global as Record<string, unknown>).it === 'function';

    if (instances.length === 0 && !isTest) {
      // viewsWelcome content now provides the primary onboarding UX
      // No dismissible dialog needed - the welcome view buttons persist
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

  const releaseTreeView = vscode.window.createTreeView('forgejoReleases', {
    treeDataProvider: releaseTreeProvider,
    showCollapseAll: true
  });

  // Create virtual document provider for PR diffs
  const prDiffProvider = new PRDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, prDiffProvider),
    prDiffProvider
  );

  // Create comment controller for inline PR comments
  const commentController = new ForgejoCommentController();
  context.subscriptions.push(commentController);

  // Register submit inline comment command
  context.subscriptions.push(
    registerCommand('forgejo.submitInlineComment', async (reply: vscode.CommentReply) => {
      await commentController.handleCreateComment(reply);
    })
  );

  // Create virtual document provider for PR details
  const prDetailsProvider = new PRDetailsContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PR_DETAILS_SCHEME, prDetailsProvider),
    prDetailsProvider
  );

  // Register instance management commands
  context.subscriptions.push(
    registerCommand('forgejo.addInstance', async () => {
      const success = await startOnboarding();
      if (success) {
        await updateNoInstanceContext();
        prTreeProvider.refresh();
        issueTreeProvider.refresh();
        actionsTreeProvider.refresh();
        releaseTreeProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.manageInstances', async () => {
      await manageInstances();
      await updateNoInstanceContext();
      prTreeProvider.refresh();
      issueTreeProvider.refresh();
      actionsTreeProvider.refresh();
      releaseTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.showDiagnostics', async () => {
      await showDiagnostics();
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.showOutput', () => {
      logger.show();
    })
  );

  // Register refresh commands
  context.subscriptions.push(
    registerCommand('forgejo.refreshPullRequests', () => {
      prTreeProvider.refresh();
      void vscode.window.showInformationMessage('Pull Requests refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshIssues', () => {
      issueTreeProvider.refresh();
      void vscode.window.showInformationMessage('Issues refreshed');
    })
  );

  // Register create issue command
  context.subscriptions.push(
    registerCommand('forgejo.createIssue', () => createIssueCommand(issueTreeProvider))
  );

  // Register create pull request command
  context.subscriptions.push(
    registerCommand('forgejo.createPullRequest', () => createPullRequestCommand(prTreeProvider))
  );

  context.subscriptions.push(
    registerCommand('forgejo.refreshActions', () => {
      actionsTreeProvider.refresh();
      void vscode.window.showInformationMessage('Actions refreshed');
    })
  );

  // Register configuration commands
  context.subscriptions.push(
    registerCommand('forgejo.configureInstanceUrl', () =>
      configureInstanceUrlCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider)
    )
  );

  context.subscriptions.push(
    registerCommand('forgejo.setAuthToken', () =>
      setAuthTokenCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider)
    )
  );

  // Register select remote command
  context.subscriptions.push(
    registerCommand('forgejo.selectRemote', () => selectRemoteCommand(prTreeProvider, issueTreeProvider, actionsTreeProvider))
  );

  // Register open in browser commands
  context.subscriptions.push(
    registerCommand('forgejo.openPrInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.openIssueInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  // Register PR file diff viewer
  context.subscriptions.push(
    registerCommand(
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
            commentController.registerPRContext(beforeUri, {
              owner, repo, prNumber: pr.number, baseRef, headRef, filePath: file.filename
            });
            const doc = await vscode.workspace.openTextDocument(beforeUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              void vscode.window.showInformationMessage(`File ${file.filename} was deleted in PR #${pr.number}`);
            }
            return;
          }

          // Handle added files (no "before" version)
          if (file.status === 'added') {
            const afterUri = createPRFileUri(owner, repo, headRef, file.filename);
            commentController.registerPRContext(afterUri, {
              owner, repo, prNumber: pr.number, baseRef, headRef, filePath: file.filename
            });
            const doc = await vscode.workspace.openTextDocument(afterUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            const showNotifications = vscode.workspace.getConfiguration('forgejo').get<boolean>('showFileStatusNotifications', true);
            if (showNotifications) {
              void vscode.window.showInformationMessage(`File ${file.filename} was added in PR #${pr.number}`);
            }
            return;
          }

          // For modified/renamed files, show diff
          const beforePath = file.previous_filename ?? file.filename;
          const afterPath = file.filename;

          const beforeUri = createPRFileUri(owner, repo, baseRef, beforePath);
          const afterUri = createPRFileUri(owner, repo, headRef, afterPath);

          // Register PR context for both sides of the diff
          commentController.registerPRContext(beforeUri, {
            owner, repo, prNumber: pr.number, baseRef, headRef, filePath: beforePath
          });
          commentController.registerPRContext(afterUri, {
            owner, repo, prNumber: pr.number, baseRef, headRef, filePath: afterPath
          });

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
          void vscode.window.showErrorMessage(
            `Failed to open diff: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Add context menu command to open PR in browser
  context.subscriptions.push(
    registerCommand(
      'forgejo.openPrInBrowserFromContext',
      (prItem: unknown) => {
        if (prItem && typeof prItem === 'object' && 'htmlUrl' in prItem && typeof prItem.htmlUrl === 'string') {
          void vscode.env.openExternal(vscode.Uri.parse(prItem.htmlUrl));
        }
      }
    )
  );

  // Add context menu command to open file in browser
  context.subscriptions.push(
    registerCommand(
      'forgejo.openPrFileInBrowser',
      (fileItem: unknown) => {
        if (fileItem && typeof fileItem === 'object' && 'file' in fileItem && fileItem.file && typeof fileItem.file === 'object' && 'blob_url' in fileItem.file && typeof fileItem.file.blob_url === 'string') {
          void vscode.env.openExternal(vscode.Uri.parse(fileItem.file.blob_url));
        }
      }
    )
  );

  // Register PR details viewer command
  context.subscriptions.push(
    registerCommand(
      'forgejo.showPrDetails',
      async (pr: PullRequestListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel
          await prDetailWebviewProvider.showPRDetails(owner, repo, pr.number);
        } catch (error) {
          console.error('[Forgejo] Error opening PR details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open PR details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register merge PR command
  context.subscriptions.push(
    registerCommand(
      'forgejo.mergePr',
      (pr: PullRequestListItem, owner: string, repo: string) => mergePrCommand(pr, owner, repo, prTreeProvider)
    )
  );

  // Register close PR command
  context.subscriptions.push(
    registerCommand(
      'forgejo.closePr',
      async (pr: PullRequestListItem, owner: string, repo: string) => {
        await closePrCommand(pr, owner, repo, prTreeProvider);
      }
    )
  );

  // Register Actions commands
  context.subscriptions.push(
    registerCommand(
      'forgejo.openActionInBrowser',
      (item: WorkflowRunTreeItem | JobTreeItem | StepTreeItem) => {
        if (item instanceof WorkflowRunTreeItem) {
          const run = item.jobs[0];
          if (run.url) {
            void vscode.env.openExternal(vscode.Uri.parse(run.url));
          }
        } else if (item instanceof JobTreeItem) {
          if (item.job.url) {
            void vscode.env.openExternal(vscode.Uri.parse(item.job.url));
          }
        } else if (item instanceof StepTreeItem) {
          // Steps don't have their own URL; open the parent job page
          void getForgejoConfig().then(config => {
            if (config) {
              const url = `${config.instanceUrl}/${item.owner}/${item.repo}/actions/runs/${item.runNumber}/jobs/${item.jobIndex}`;
              void vscode.env.openExternal(vscode.Uri.parse(url));
            }
          });
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand(
      'forgejo.openActionInBrowserDirect',
      (url: string) => {
        if (url) {
          void vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand(
      'forgejo.rerunAction',
      async (item: WorkflowRunTreeItem | JobTreeItem) => {
        // Get the run data from either a run item or a job item
        const run = item instanceof WorkflowRunTreeItem ? item.jobs[0] : item.job;

        try {
          const confirm = await vscode.window.showWarningMessage(
            `Re-run workflow "${run.name}"?`,
            { modal: true },
            'Re-run'
          );

          if (confirm !== 'Re-run') {
            return;
          }

          const config = await getForgejoConfig();
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          const client = new ForgejoClient(config.instanceUrl, config.token);
          await client.rerunWorkflow(item.owner, item.repo, run.id);

          void vscode.window.showInformationMessage('Workflow re-run triggered!');
          actionsTreeProvider.refresh();
        } catch (error) {
          console.error('[Forgejo] Error re-running workflow:', error);
          void vscode.window.showErrorMessage(
            `Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register Action details viewer command
  context.subscriptions.push(
    registerCommand(
      'forgejo.showActionDetails',
      async (run: WorkflowRunListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel with the run data we already have
          await actionDetailWebviewProvider.showActionDetails(owner, repo, run);
        } catch (error) {
          console.error('[Forgejo] Error opening Action details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open Action details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  context.subscriptions.push(
    registerCommand(
      'forgejo.viewActionLogs',
      async (run: WorkflowRunListItem, job: WorkflowJob, owner: string, repo: string) => {
        try {
          const config = await getForgejoConfig();
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          void vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching logs for ${job.name}...`,
              cancellable: false
            },
            async () => {
              const client = new ForgejoClient(config.instanceUrl, config.token);
              // Extract job index from html_url (e.g., .../jobs/0)
              const urlParts = job.html_url?.split('/') ?? [];
              const jobIndex = parseInt(urlParts[urlParts.length - 1] ?? '0', 10) || 0;

              const logs = await client.getWorkflowLogs(owner, repo, run.run_number, jobIndex);

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
          void vscode.window.showErrorMessage(
            `Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register step log viewer command (triggered by clicking a step in the tree)
  context.subscriptions.push(
    registerCommand(
      'forgejo.viewStepLogs',
      async (args: StepLogArgs) => {
        try {
          const config = await getForgejoConfig();
          if (!config) {
            void vscode.window.showErrorMessage('Forgejo configuration not found');
            return;
          }

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Fetching logs for ${args.stepSummary}...`,
              cancellable: false
            },
            async () => {
              const client = new ForgejoClient(config.instanceUrl, config.token);
              const logs = await client.getWorkflowLogs(
                args.owner, args.repo, args.runNumber, args.jobIndex
              );

              const doc = await vscode.workspace.openTextDocument({
                content: logs,
                language: 'log'
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            }
          );
        } catch (error) {
          console.error('[Forgejo] Error fetching step logs:', error);
          void vscode.window.showErrorMessage(
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
    registerCommand(
      'forgejo.showIssueDetails',
      async (issue: IssueListItem, owner: string, repo: string) => {
        try {
          // Show the webview panel
          await issueDetailWebviewProvider.showIssueDetails(owner, repo, issue.number);
        } catch (error) {
          console.error('[Forgejo] Error opening Issue details:', error);
          void vscode.window.showErrorMessage(
            `Failed to open Issue details: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    )
  );

  // Register open issue in browser from context menu command
  context.subscriptions.push(
    registerCommand(
      'forgejo.openIssueInBrowserFromContext',
      (issueItem: unknown) => {
        if (issueItem && typeof issueItem === 'object' && 'htmlUrl' in issueItem && typeof issueItem.htmlUrl === 'string') {
          void vscode.env.openExternal(vscode.Uri.parse(issueItem.htmlUrl));
        }
      }
    )
  );

  // Register release commands
  context.subscriptions.push(
    registerCommand('forgejo.refreshReleases', () => {
      releaseTreeProvider.refresh();
      void vscode.window.showInformationMessage('Releases refreshed');
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.openReleaseInBrowser', (url: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    })
  );

  context.subscriptions.push(
    registerCommand('forgejo.createRelease', () => createReleaseCommand(releaseTreeProvider))
  );

  // Add releases tree view to subscriptions
  context.subscriptions.push(releaseTreeView);

  // Add logger to subscriptions for proper cleanup
  context.subscriptions.push(logger);

  logInfo('Extension activation complete');
}

export function deactivate() {
  logInfo('Extension is now deactivated');
}
