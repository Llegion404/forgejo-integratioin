import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { WorkflowRun, WorkflowRunListItem, WorkflowJob, WorkflowJobRef } from '../../models/action';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'rerun' }
  | { type: 'cancel' }
  | { type: 'openInBrowser' }
  | { type: 'viewLogs'; jobRef: WorkflowJobRef };

function isValidJobRef(jobRef: unknown): jobRef is WorkflowJobRef {
  if (!jobRef || typeof jobRef !== 'object') {
    return false;
  }

  const ref = jobRef as WorkflowJobRef;
  return typeof ref.jobHtmlUrl === 'string'
    || typeof ref.jobId === 'number'
    || typeof ref.jobIndex === 'number';
}

export type ExtensionMessage =
  | { type: 'update'; data: ActionDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' };

export interface ActionDetailViewData {
  run: WorkflowRun;
  jobs: WorkflowJob[];
  owner: string;
  repo: string;
  jobsWarning?: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  runId: number;
  run: WorkflowRunListItem;  // Store the run data to avoid 404 on /actions/runs/{id}
  isReady: boolean;
  pendingData?: ActionDetailViewData | null;
  pendingError?: string | null;
  pendingJobsWarning?: string;
  lastRequestId: number;
}

export class ActionDetailWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.actionDetail';
  public readonly viewType = 'forgejo.actionDetail';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showActionDetails(owner: string, repo: string, run: WorkflowRunListItem): Promise<void> {
    const runId = run.id;
    logInfo('Showing action details in webview:', { owner, repo, runId });

    const panelKey = `${owner}/${repo}/${String(runId)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadActionData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ActionDetailWebviewProvider.viewType,
      `Action #${String(runId)}: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri]
      }
    );

    const state: PanelState = {
      panel,
      owner,
      repo,
      runId,
      run,
      isReady: false,
      pendingData: null,
      pendingError: null,
      lastRequestId: 0
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this._handleMessage(message as WebviewMessage, panelKey);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      logInfo('Action detail webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    void this._fetchActionData(panelKey);
  }

  private async _fetchActionData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const requestId = ++state.lastRequestId;
    const { panel, owner, repo, run } = state;
    logInfo('_fetchActionData starting:', { panelKey, isReady: state.isReady, requestId });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);

      // The list item carries status/conclusion/created_at/updated_at but not
      // started_at/stopped_at/run_started_at. Approximate honestly: use
      // created_at for start, and updated_at for stop only when the run is
      // terminal (conclusion set or a terminal status), so finished runs show
      // a stable duration instead of an ever-growing timer.
      const terminalStatuses = ['success', 'failure', 'cancelled', 'skipped'];
      const isTerminal = !!run.conclusion || terminalStatuses.includes(run.status);
      const fullRun: WorkflowRun = {
        ...run,
        started_at: run.created_at,
        run_started_at: run.created_at,
        stopped_at: isTerminal ? run.updated_at : null
      };

      // Fetch jobs; surface a per-section warning instead of silently showing "No jobs".
      let jobs: WorkflowJob[] = [];
      let jobsWarning = '';
      try {
        const jobsResponse = await client.getWorkflowJobs(owner, repo, run.id);
        if (requestId !== state.lastRequestId) return;
        jobs = jobsResponse.jobs;
      } catch (jobError) {
        logError('Failed to fetch jobs:', jobError);
        jobsWarning = jobError instanceof Error ? jobError.message : 'Could not load jobs';
      }

      state.pendingData = { run: fullRun, jobs, owner, repo, jobsWarning: jobsWarning || undefined };
      state.pendingError = null;

      if (state.isReady) {
        this._sendDataToPanel(panelKey);
      }
    } catch (error) {
      logError('Failed to fetch action data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load action details';
      if (state.isReady) {
        void panel.webview.postMessage({ type: 'error', message: errorMessage });
      } else {
        state.pendingError = errorMessage;
      }
    }
  }

  private _sendDataToPanel(panelKey: string): void {
    const state = this._panels.get(panelKey);
    if (!state?.pendingData) {
      logInfo('_sendDataToPanel: no state or pendingData');
      return;
    }

    const { panel } = state;
    logInfo('Posting messages to webview:', { runName: state.pendingData.run.name });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadActionData(panelKey: string): Promise<void> {
    await this._fetchActionData(panelKey);
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, runId } = state;

    // Generic message types (openUserProfile / openInBrowserFromUrl / log / …)
    if (await this._handleBaseMessage(message, panel.webview)) return;

    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingError) {
          void panel.webview.postMessage({ type: 'error', message: state.pendingError });
          state.pendingError = null;
        } else if (state.pendingData) {
          this._sendDataToPanel(panelKey);
        } else {
          void panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'refresh':
        await this._fetchActionData(panelKey);
        break;
      case 'rerun':
        await this._rerunWorkflow(owner, repo, runId, panelKey);
        break;
      case 'cancel':
        await this._cancelWorkflow(owner, repo, runId, panelKey);
        break;
      case 'openInBrowser':
        await this._openInBrowser(owner, repo, runId);
        break;
      case 'viewLogs':
        if (!isValidJobRef(message.jobRef)) {
          void vscode.window.showErrorMessage('Action log request did not include a valid job reference');
          return;
        }
        await this._viewLogs(owner, repo, runId, message.jobRef);
        break;
    }
  }

  private async _rerunWorkflow(owner: string, repo: string, runId: number, panelKey: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage('Re-run this workflow?', { modal: true }, 'Re-run');
    if (confirm !== 'Re-run') return;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.rerunWorkflow(owner, repo, runId);
      void vscode.window.showInformationMessage('Workflow re-run triggered successfully');
      await this._fetchActionData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _cancelWorkflow(owner: string, repo: string, runId: number, panelKey: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage('Cancel this workflow run?', { modal: true }, 'Cancel run');
    if (confirm !== 'Cancel run') return;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.cancelWorkflowRun(owner, repo, runId);
      void vscode.window.showInformationMessage('Workflow cancelled');
      await this._fetchActionData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to cancel workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openInBrowser(owner: string, repo: string, runId: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');

      // Get run_number from stored run data (web UI uses run_number, not internal id)
      const panelKey = `${owner}/${repo}/${String(runId)}`;
      const state = this._panels.get(panelKey);
      const runNumber = state?.run.run_number ?? runId;

      const url = `${config.instanceUrl}/${owner}/${repo}/actions/runs/${String(runNumber)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _viewLogs(owner: string, repo: string, runId: number, jobRef: WorkflowJobRef): Promise<void> {
    // Get the run data to access run_number (sequential index, not internal id)
    const panelKey = `${owner}/${repo}/${String(runId)}`;
    const state = this._panels.get(panelKey);
    const run = state?.pendingData?.run;

    if (!run) {
      void vscode.window.showErrorMessage('Run data not available');
      return;
    }

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Fetching logs for ${run.name}...`,
        cancellable: false
      }, async () => {
        const client = new ForgejoClient(config.instanceUrl, config.token);
        const logs = await client.getWorkflowLogs(owner, repo, run.run_number, jobRef);

        // Create untitled document with logs
        const doc = await vscode.workspace.openTextDocument({
          content: logs,
          language: 'log'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      });
    } catch (error) {
      const is404 = error instanceof Error && error.message.includes('404');
      const msg = is404
        ? 'Logs not available — private repo action logs are not supported due to auth limitations.'
        : `Failed to view logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
      void vscode.window.showErrorMessage(msg);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'index.js'));

    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Action Details</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading action details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
    <span class="error-icon codicon codicon-error" aria-hidden="true"></span>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <!-- Health Summary -->
    <div class="health-summary">
      <span id="health-badge" class="health-badge"></span>
      <span id="health-stats" class="health-stats"></span>
    </div>

    <!-- Run Info Header -->
    <header class="action-header">
      <div class="action-title-row">
        <h1 id="action-name"></h1>
        <span id="run-number"></span>
      </div>
      <div class="run-meta">
        <div class="run-meta-item">
          <span class="label">Commit:</span>
          <span id="commit-info"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Branch:</span>
          <span id="branch-name"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Trigger:</span>
          <span id="event-type"></span>
        </div>
        <div class="run-meta-item">
          <span class="label">Duration:</span>
          <span id="duration"></span>
        </div>
      </div>
    </header>

    <!-- Action Bar -->
    <nav class="action-bar">
      <button id="refresh-btn" class="btn btn-secondary"><span class="codicon codicon-refresh" aria-hidden="true"></span> Refresh</button>
      <button id="rerun-btn" class="btn btn-primary"><span class="codicon codicon-run-below" aria-hidden="true"></span> Re-run Workflow</button>
      <button id="cancel-btn" class="btn btn-danger" style="display: none;"><span class="codicon codicon-stop-circle" aria-hidden="true"></span> Cancel Workflow</button>
      <button id="open-web-btn" class="btn btn-secondary"><span class="codicon codicon-globe" aria-hidden="true"></span> Open in Browser</button>
    </nav>

    <!-- Jobs Section -->
    <section class="jobs-section">
      <h2>Jobs <span id="jobs-count"></span></h2>
      <div id="jobs-warning" class="jobs-warning" style="display: none;"></div>
      <div id="jobs-list"></div>
    </section>

    <!-- Failing Steps Summary -->
    <section id="failures-section" class="failures-section" style="display: none;">
      <h2>Failed Steps</h2>
      <div id="failures-list"></div>
    </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
