import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' };

export interface SettingsViewData {
  owner: string;
  repo: string;
  branches: { name: string; commit: { id: string }; protected: boolean }[];
  protections: { rule_name: string; approvals_whitelist_teams?: string[]; enable_push?: boolean }[];
  collaborators: { login: string; avatar_url?: string; permissions?: { admin: boolean; push: boolean; pull: boolean } }[];
  webhooks: { id: number; url: string; events: string[]; active: boolean; config?: { url: string; content_type: string } }[];
  deployKeys: { id: number; title: string; key: string; read_only: boolean }[];
  instanceUrl: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  isReady: boolean;
  pendingData?: SettingsViewData | null;
  lastRequestId: number;
}

export class SettingsWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.repoSettings';
  public readonly viewType = 'forgejo.repoSettings';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showSettings(owner: string, repo: string): Promise<void> {
    logInfo('Showing repo settings:', { owner, repo });
    const panelKey = `${owner}/${repo}/settings`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) state.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsWebviewProvider.viewType,
      `Settings: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this._extensionUri] }
    );

    const state: PanelState = {
      panel, owner, repo,
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
    const { panel, owner, repo } = state;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No Forgejo config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const [branches, protections, collaborators, webhooks, deployKeys] = await Promise.all([
        client.listRepoBranches(owner, repo).catch(() => []),
        client.listBranchProtections(owner, repo).catch(() => []),
        client.listRepoCollaborators(owner, repo).catch(() => []),
        client.listRepoWebhooks(owner, repo).catch(() => []),
        client.listRepoDeployKeys(owner, repo).catch(() => []),
      ]);
      if (requestId !== state.lastRequestId) return;
      state.pendingData = {
        owner, repo,
        branches: Array.isArray(branches) ? branches : [],
        protections: Array.isArray(protections) ? protections : [],
        collaborators: Array.isArray(collaborators) ? collaborators : [],
        webhooks: Array.isArray(webhooks) ? webhooks : [],
        deployKeys: Array.isArray(deployKeys) ? deployKeys : [],
        instanceUrl: config.instanceUrl,
      };
      if (state.isReady) this._sendData(panelKey);
    } catch (error) {
      logError('Settings fetch failed:', error);
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load repository settings',
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
    logDebug('settings message:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;
    const { owner, repo } = state;
    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingData) this._sendData(panelKey);
        else void this._fetchData(panelKey);
        break;
      case 'refresh': void this._fetchData(panelKey); break;
      case 'openInBrowser': {
        const config = await getForgejoConfig();
        if (config) void vscode.env.openExternal(vscode.Uri.parse(`${config.instanceUrl}/${owner}/${repo}/settings`));
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'settings', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'settings', 'index.js'));
    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Repository Settings</title>
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
    <header class="settings-header">
      <h1>Repository Settings</h1>
      <div class="action-bar">
        <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
        <button id="open-web-btn" class="btn btn-secondary">Open in Browser</button>
      </div>
    </header>
    <nav class="tab-bar">
      <button class="tab-btn active" data-tab="branches">Branches</button>
      <button class="tab-btn" data-tab="protection">Branch Protection</button>
      <button class="tab-btn" data-tab="collaborators">Collaborators</button>
      <button class="tab-btn" data-tab="webhooks">Webhooks</button>
      <button class="tab-btn" data-tab="keys">Deploy Keys</button>
    </nav>
    <section id="tab-branches" class="tab-panel active"></section>
    <section id="tab-protection" class="tab-panel"></section>
    <section id="tab-collaborators" class="tab-panel"></section>
    <section id="tab-webhooks" class="tab-panel"></section>
    <section id="tab-keys" class="tab-panel"></section>
  </div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
