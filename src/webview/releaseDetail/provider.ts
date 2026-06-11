import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { type Release } from 'forgejo-ts';
import { logDebug, logInfo, logError } from '../../utils/logger';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' }
  | { type: 'openAsset'; url: string }
  | { type: 'copyTag' };

export type ExtensionMessage =
  | { type: 'update'; data: ReleaseDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' };

export interface ReleaseDetailViewData {
  release: Release;
  owner: string;
  repo: string;
  instanceUrl: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  tagName: string;
  isReady: boolean;
  pendingData?: ReleaseDetailViewData | null;
}

export class ReleaseDetailWebviewProvider {
  public static readonly viewType = 'forgejo.releaseDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showReleaseDetails(owner: string, repo: string, release: Release): Promise<void> {
    const tagName = release.tag_name;
    logInfo('Showing release details in webview:', { owner, repo, tagName });

    const panelKey = `${owner}/${repo}/release/${tagName}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReleaseDetailWebviewProvider.viewType,
      `Release ${release.name || tagName}: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this._extensionUri]
      }
    );

    const config = await getForgejoConfig();
    const instanceUrl = config?.instanceUrl || '';

    const state: PanelState = {
      panel,
      owner,
      repo,
      tagName,
      isReady: false,
      pendingData: { release, owner, repo, instanceUrl }
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
      logInfo('Webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    if (state.pendingData) {
      this._sendDataToPanel(panelKey);
    }
  }

  private _sendDataToPanel(panelKey: string): void {
    const state = this._panels.get(panelKey);
    if (!state?.pendingData) return;

    const { panel } = state;
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo } = state;

    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingData) {
          this._sendDataToPanel(panelKey);
        }
        break;
      case 'openInBrowser': {
        const config = await getForgejoConfig();
        if (!config) break;
        const url = `${config.instanceUrl}/${owner}/${repo}/releases/tag/${encodeURIComponent(state.tagName)}`;
        void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case 'openAsset':
        if (message.url) {
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case 'copyTag':
        await vscode.env.clipboard.writeText(state.tagName);
        void vscode.window.showInformationMessage(`Tag "${state.tagName}" copied to clipboard`);
        break;
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'releaseDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'releaseDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https:;">
  <title>Release Details</title>
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line short"></div>
  </div>

  <div id="error" class="error" style="display: none;">
    <div class="error-icon">&#x26A0;&#xFE0F;</div>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="release-header">
      <div class="release-title-row">
        <h1 id="release-title"></h1>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">&#x1F4CB;</button>
      </div>
      <div class="release-meta">
        <span id="release-status-badge" class="status-badge"></span>
        <span class="release-author">by <a class="user-link" id="author-name" href="#"></a></span>
        <span id="release-date" class="release-date"></span>
      </div>
      <div class="release-tag-row">
        <span id="release-tag" class="release-tag"></span>
        <button id="copy-tag-btn" class="btn btn-secondary btn-small">Copy Tag</button>
      </div>
    </header>

    <nav class="action-bar">
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
    </nav>

    <section class="release-body-section">
      <h2>Release Notes</h2>
      <div id="release-body" class="markdown-body"></div>
    </section>

    <section id="assets-section" class="assets-section" style="display: none;">
      <h2>Assets</h2>
      <div id="assets-list" class="assets-list"></div>
    </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
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
