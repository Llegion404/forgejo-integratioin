import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { WorkflowRun, WorkflowJob } from '../../models/action';
import { logDebug, logInfo, logError } from '../../utils/logger';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'rerun' }
  | { type: 'openInBrowser' }
  | { type: 'viewLogs'; jobIndex: number };

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
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  runId: number;
  isReady: boolean;
  pendingData?: ActionDetailViewData | null;
}

export class ActionDetailWebviewProvider {
  public static readonly viewType = 'forgejo.actionDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showActionDetails(owner: string, repo: string, runId: number): Promise<void> {
    logInfo('Showing action details in webview:', { owner, repo, runId });

    const panelKey = `${owner}/${repo}/${runId}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey)!;
      state.panel.reveal(vscode.ViewColumn.One);
      await this._loadActionData(panelKey);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ActionDetailWebviewProvider.viewType,
      `Action #${runId}: ${owner}/${repo}`,
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
      isReady: false,
      pendingData: null
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        await this._handleMessage(message, panelKey);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      logInfo('Action detail webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    this._fetchActionData(panelKey);
  }

  private async _fetchActionData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, runId } = state;
    logInfo('_fetchActionData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching action details from API...');

      const [run, jobsResponse] = await Promise.all([
        client.getWorkflowRunDetails(owner, repo, runId),
        client.getWorkflowJobs(owner, repo, runId)
      ]);

      logInfo('Action details fetched:', { name: run.name, jobCount: jobsResponse.jobs.length });

      state.pendingData = { run, jobs: jobsResponse.jobs, owner, repo };
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        await this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      logError('Failed to fetch action data:', error);
      if (state.isReady) {
        panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load action details'
        });
      }
    }
  }

  private async _sendDataToPanel(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state || !state.pendingData) {
      logInfo('_sendDataToPanel: no state or pendingData');
      return;
    }

    const { panel } = state;
    logInfo('Posting messages to webview:', { runName: state.pendingData.run.name });
    panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    panel.webview.postMessage({ type: 'loading', show: true });
    panel.webview.postMessage({ type: 'update', data: state.pendingData });
    panel.webview.postMessage({ type: 'loading', show: false });
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

    switch (message.type) {
      case 'ready':
        logInfo('Webview ready message received, pendingData exists:', !!state.pendingData);
        state.isReady = true;
        if (state.pendingData) {
          logInfo('Sending pending data to webview...');
          await this._sendDataToPanel(panelKey);
        } else {
          logInfo('No pending data yet, showing loading state');
          panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'refresh':
        await this._fetchActionData(panelKey);
        break;
      case 'rerun':
        await this._rerunWorkflow(owner, repo, runId, panelKey);
        break;
      case 'openInBrowser':
        await this._openInBrowser(owner, repo, runId);
        break;
      case 'viewLogs':
        await this._viewLogs(owner, repo, runId, message.jobIndex);
        break;
    }
  }

  private async _rerunWorkflow(owner: string, repo: string, runId: number, panelKey: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.rerunWorkflow(owner, repo, runId);
      vscode.window.showInformationMessage('Workflow re-run triggered successfully');
      await this._fetchActionData(panelKey);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to re-run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openInBrowser(owner: string, repo: string, runId: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${owner}/${repo}/actions/runs/${runId}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _viewLogs(owner: string, repo: string, runNumber: number, jobIndex: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      // Open logs in browser - Forgejo's log viewing is complex and best done in browser
      const url = `${config.instanceUrl}/${owner}/${repo}/actions/runs/${runNumber}/jobs/${jobIndex}/logs`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to view logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _getThemeName(kind: vscode.ColorThemeKind): 'light' | 'dark' | 'high-contrast' {
    switch (kind) {
      case vscode.ColorThemeKind.Light: return 'light';
      case vscode.ColorThemeKind.HighContrast: return 'high-contrast';
      case vscode.ColorThemeKind.HighContrastLight: return 'high-contrast';
      default: return 'dark';
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'actionDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
  <title>Action Details</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading action details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
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
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="rerun-btn" class="btn btn-primary">Re-run Workflow</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Browser</button>
    </nav>

    <!-- Jobs Section -->
    <section class="jobs-section">
      <h2>Jobs <span id="jobs-count"></span></h2>
      <div id="jobs-list"></div>
    </section>

    <!-- Failing Steps Summary -->
    <section id="failures-section" class="failures-section" style="display: none;">
      <h2>Failed Steps</h2>
      <div id="failures-list"></div>
    </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
