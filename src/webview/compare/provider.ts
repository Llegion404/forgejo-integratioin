import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' };

export interface CompareViewData {
  base: string;
  head: string;
  owner: string;
  repo: string;
  totalCommits: number;
  commits: { sha: string; message: string; author?: string; date?: string }[];
  files: { filename: string; status: string; additions: number; deletions: number; changes: number }[];
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  base: string;
  head: string;
  isReady: boolean;
  pendingData?: CompareViewData | null;
  lastRequestId: number;
}

export class CompareWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.compare';
  public readonly viewType = 'forgejo.compare';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showCompare(owner: string, repo: string, base: string, head: string): Promise<void> {
    logInfo('Showing compare:', { owner, repo, base, head });
    const panelKey = `${owner}/${repo}/compare/${base}...${head}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) state.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CompareWebviewProvider.viewType,
      `Compare ${base}...${head}: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this._extensionUri] }
    );

    const state: PanelState = {
      panel, owner, repo, base, head,
      isReady: false, pendingData: null, lastRequestId: 0,
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: unknown) => void this._handleMessage(message as WebviewMessage, panelKey),
      undefined, []
    );
    panel.onDidDispose(() => { this._panels.delete(panelKey); }, undefined, []);

    void this._fetchData(panelKey);
  }

  private async _fetchData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;
    const requestId = ++state.lastRequestId;
    const { panel, owner, repo, base, head } = state;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No Forgejo config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const cmp = await (client as any).rawRequest('GET', `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
      if (requestId !== state.lastRequestId) return;
      state.pendingData = {
        base, head, owner, repo,
        totalCommits: cmp.total_commits ?? (cmp.commits?.length ?? 0),
        commits: (cmp.commits || []).map((c: any) => ({
          sha: c.sha,
          message: c.commit?.message?.split('\n')[0] || '',
          author: c.author?.login || c.commit?.author?.name,
          date: c.commit?.author?.date,
        })),
        files: (cmp.files || []).map((f: any) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })),
      };
      if (state.isReady) this._sendData(panelKey);
    } catch (error) {
      logError('Compare fetch failed:', error);
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load compare',
        });
      }
    }
  }

  private _sendData(panelKey: string): void {
    const state = this._panels.get(panelKey);
    if (!state?.pendingData) return;
    void state.panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void state.panel.webview.postMessage({ type: 'loading', show: true });
    void state.panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void state.panel.webview.postMessage({ type: 'loading', show: false });
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('compare message:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;
    const { owner, repo, base, head } = state;
    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingData) this._sendData(panelKey);
        else void this._fetchData(panelKey);
        break;
      case 'refresh': void this._fetchData(panelKey); break;
      case 'openInBrowser': {
        const config = await getForgejoConfig();
        if (config) {
          void vscode.env.openExternal(vscode.Uri.parse(`${config.instanceUrl}/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`));
        }
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'compare', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'compare', 'index.js'));
    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Compare</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-line"></div>
  </div>
  <div id="error" class="error" style="display: none;">
    <div class="error-icon">&#x26A0;&#xFE0F;</div>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>
  <div id="content" style="display: none;">
    <header class="compare-header">
      <h1 id="compare-title"></h1>
      <div class="action-bar">
        <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
        <button id="open-web-btn" class="btn btn-secondary">Open in Browser</button>
      </div>
    </header>
    <section class="commits-section">
      <h2>Commits <span id="commit-count" class="count-pill"></span></h2>
      <ul id="commits-list" class="commits-list"></ul>
    </section>
    <section class="files-section">
      <h2>Changed Files <span id="file-count" class="count-pill"></span></h2>
      <div id="files-list" class="files-list"></div>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
