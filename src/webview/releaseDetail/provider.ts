import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { type Release } from 'forgejo-ts';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' }
  | { type: 'openUserProfile'; username: string }
  | { type: 'openAsset'; url: string }
  | { type: 'copyTag' }
  | { type: 'editRelease'; name: string; body: string }
  | { type: 'deleteRelease' }
  | { type: 'markLatest' }
  | { type: 'togglePrerelease'; isPrerelease: boolean };

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
  lastRequestId: number;
}

export class ReleaseDetailWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.releaseDetail';
  public readonly viewType = 'forgejo.releaseDetail';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

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
      pendingData: { release, owner, repo, instanceUrl },
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

    // Generic message types (openUserProfile / openInBrowserFromUrl / log / …)
    if (await this._handleBaseMessage(message, panel.webview)) return;

    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingData) {
          this._sendDataToPanel(panelKey);
        }
        break;
      case 'refresh':
        await this._refreshRelease(owner, repo, state);
        break;
      case 'openInBrowser': {
        const config = await getForgejoConfig();
        if (!config) break;
        const url = `${config.instanceUrl}/${owner}/${repo}/releases/tag/${encodeURIComponent(state.tagName)}`;
        void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case 'openAsset':
        this._openExternal(message.url);
        break;
      case 'copyTag':
        await vscode.env.clipboard.writeText(state.tagName);
        void vscode.window.showInformationMessage(`Tag "${state.tagName}" copied to clipboard`);
        break;
      case 'editRelease':
        await this._editRelease(owner, repo, state, message.name, message.body);
        break;
      case 'deleteRelease':
        await this._deleteRelease(owner, repo, state);
        break;
      case 'markLatest':
        // Forgejo computes `is_latest` server-side; this clears the prerelease
        // flag so the release becomes a stable release candidate for "latest".
        await this._updateRelease(owner, repo, state, { is_prerelease: false });
        break;
      case 'togglePrerelease':
        await this._updateRelease(owner, repo, state, { is_prerelease: message.isPrerelease });
        break;
    }
  }

  private async _refreshRelease(owner: string, repo: string, state: PanelState): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const release = await client.getReleaseByTag(owner, repo, state.tagName);
      state.pendingData = { release, owner, repo, instanceUrl: config.instanceUrl };
      this._sendDataToPanel(this._panelKey(state));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to refresh release: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _editRelease(owner: string, repo: string, state: PanelState, name: string, body: string): Promise<void> {
    try {
      if (!state.pendingData) return;
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const releaseId = state.pendingData.release.id;
      await this._rawUpdateRelease(client, owner, repo, releaseId, { name, body });
      void vscode.window.showInformationMessage('Release updated');
      state.pendingData = { ...state.pendingData, release: { ...state.pendingData.release, name, body } };
      this._sendDataToPanel(this._panelKey(state));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to edit release: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _deleteRelease(owner: string, repo: string, state: PanelState): Promise<void> {
    try {
      const confirm = await vscode.window.showWarningMessage(
        `Delete release "${state.pendingData?.release.name || state.tagName}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      if (!state.pendingData) return;
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.deleteRelease(owner, repo, state.pendingData.release.id);
      void vscode.window.showInformationMessage('Release deleted');
      state.panel.dispose();
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to delete release: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _updateRelease(owner: string, repo: string, state: PanelState, patch: Record<string, unknown>): Promise<void> {
    try {
      if (!state.pendingData) return;
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await this._rawUpdateRelease(client, owner, repo, state.pendingData.release.id, patch);
      const updated = { ...state.pendingData.release, ...patch } as any;
      state.pendingData = { ...state.pendingData, release: updated };
      this._sendDataToPanel(this._panelKey(state));
      void vscode.window.showInformationMessage('Release updated');
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to update release: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _panelKey(state: PanelState): string {
    return `${state.owner}/${state.repo}/release/${state.tagName}`;
  }

  private async _rawUpdateRelease(client: ForgejoClient, owner: string, repo: string, releaseId: number, patch: Record<string, unknown>): Promise<void> {
    // PATCH /repos/{owner}/{repo}/releases/{id}
    await (client as any).rawRequest('PATCH', `/repos/${owner}/${repo}/releases/${String(releaseId)}`, patch);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'releaseDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'releaseDetail', 'index.js'));

    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Release Details</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line short"></div>
  </div>

  <div id="error" class="error" style="display: none;">
    <span class="error-icon codicon codicon-error" aria-hidden="true"></span>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="release-header">
      <div class="release-title-row">
        <h1 id="release-title"></h1>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL"><span class="codicon codicon-link" aria-hidden="true"></span></button>
      </div>
      <div class="release-meta">
        <span id="release-status-badge" class="status-badge"></span>
        <span class="release-author">by <a class="user-link" id="author-name" href="#"></a></span>
        <span id="release-date" class="release-date"></span>
      </div>
      <div class="release-tag-row">
        <span id="release-tag" class="release-tag"></span>
        <button id="copy-tag-btn" class="btn btn-secondary btn-sm">Copy Tag</button>
      </div>
    </header>

    <nav class="action-bar">
      <button id="refresh-btn" class="btn btn-secondary"><span class="codicon codicon-refresh" aria-hidden="true"></span> Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary"><span class="codicon codicon-globe" aria-hidden="true"></span> Open in Web</button>
      <button id="edit-btn" class="btn btn-secondary"><span class="codicon codicon-edit" aria-hidden="true"></span> Edit</button>
      <button id="mark-latest-btn" class="btn btn-secondary" title="Clear the prerelease flag so this release becomes a stable release">Mark Stable</button>
      <button id="toggle-prerelease-btn" class="btn btn-secondary">Toggle Prerelease</button>
      <button id="delete-btn" class="btn btn-danger"><span class="codicon codicon-trash" aria-hidden="true"></span> Delete</button>
    </nav>

    <div id="edit-dialog" class="modal-overlay" style="display: none;">
      <div class="modal">
        <h3>Edit Release</h3>
        <input id="edit-name" class="modal-input" placeholder="Release title">
        <textarea id="edit-body" class="modal-textarea" placeholder="Release notes (markdown)"></textarea>
        <div class="modal-actions">
          <button id="confirm-edit-btn" class="btn btn-primary">Save</button>
          <button id="cancel-edit-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>

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
}
