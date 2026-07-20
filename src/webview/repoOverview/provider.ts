import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';
import { type Release } from 'forgejo-ts';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' }
  | { type: 'openFile'; path: string }
  | { type: 'openRelease'; releaseId: number }
  | { type: 'openContributor'; login: string };

export interface RepoOverviewViewData {
  repo: {
    name: string;
    full_name: string;
    description: string;
    html_url: string;
    stars: number;
    forks_count: number;
    open_issues_count: number;
    language: string;
    license?: { name: string };
    default_branch: string;
    owner: { login: string; avatar_url?: string };
  };
  languages: Record<string, number>;
  topFiles: { name: string; path: string; type: string; size: number }[];
  readmeHtml: string;
  latestRelease?: Release | null;
  contributors: { login: string; contributions: number; avatar_url?: string }[];
  owner: string;
  repoName: string;
  instanceUrl: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  isReady: boolean;
  pendingData?: RepoOverviewViewData | null;
  lastRequestId: number;
}

export class RepoOverviewWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.repoOverview';
  public readonly viewType = 'forgejo.repoOverview';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showOverview(owner: string, repo: string): Promise<void> {
    logInfo('Showing repo overview:', { owner, repo });
    const panelKey = `${owner}/${repo}/overview`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._fetchData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      RepoOverviewWebviewProvider.viewType,
      `Overview: ${owner}/${repo}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this._extensionUri] }
    );

    const state: PanelState = {
      panel,
      owner,
      repo,
      isReady: false,
      pendingData: null,
      lastRequestId: 0,
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: unknown) => void this._handleMessage(message as WebviewMessage, panelKey),
      undefined,
      []
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
      const [repoData, languages, topFiles, readme, releases, contributors] = await Promise.all([
        client.getRepo(owner, repo),
        client.listRepoLanguages(owner, repo).catch(() => ({})),
        client.listRepoTopFiles(owner, repo).catch(() => []),
        client.getReadme(owner, repo).catch(() => null),
        client.listReleases(owner, repo).catch(() => []),
        client.listRepoContributors(owner, repo).catch(() => []),
      ]);
      if (requestId !== state.lastRequestId) return;
      let readmeHtml = '';
      if (readme && readme.content) {
        try {
          readmeHtml = Buffer.from(readme.content, readme.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
        } catch { readmeHtml = ''; }
      }
      const latestRelease = Array.isArray(releases) && releases.length > 0
        ? releases.find(r => !r.draft && !r.prerelease) || releases[0]
        : null;
      state.pendingData = {
        repo: repoData as RepoOverviewViewData['repo'],
        languages,
        topFiles: Array.isArray(topFiles) ? topFiles.slice(0, 20) : [],
        readmeHtml,
        latestRelease: latestRelease || null,
        contributors: Array.isArray(contributors) ? contributors.slice(0, 12) : [],
        owner,
        repoName: repo,
        instanceUrl: config.instanceUrl,
      };
      if (state.isReady) this._sendData(panelKey);
    } catch (error) {
      logError('Repo overview fetch failed:', error);
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load repository overview',
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
    logDebug('repoOverview message:', message.type);
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
        if (config) void vscode.env.openExternal(vscode.Uri.parse(`${config.instanceUrl}/${owner}/${repo}`));
        break;
      }
      case 'openFile': {
        const config = await getForgejoConfig();
        if (config) {
          void vscode.env.openExternal(vscode.Uri.parse(`${config.instanceUrl}/${owner}/${repo}/src/branch/${encodeURIComponent(state.pendingData?.repo.default_branch || 'main')}/${encodeURIComponent(message.path)}`));
        }
        break;
      }
      case 'openRelease':
        vscode.commands.executeCommand('forgejo.showReleaseDetails', { release: { id: message.releaseId, tag_name: '' }, owner, repo });
        break;
      case 'openContributor': {
        const config = await getForgejoConfig();
        if (config) void vscode.env.openExternal(vscode.Uri.parse(`${config.instanceUrl}/${encodeURIComponent(message.login)}`));
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'repoOverview', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'repoOverview', 'index.js'));
    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Repository Overview</title>
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
    <div class="error-icon">&#x26A0;&#xFE0F;</div>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>
  <div id="content" style="display: none;">
    <header class="repo-header">
      <div class="repo-title-row">
        <h1 id="repo-name"></h1>
        <button id="open-web-btn" class="btn btn-secondary btn-small">Open in Browser</button>
        <button id="refresh-btn" class="btn btn-secondary btn-small">Refresh</button>
      </div>
      <p id="repo-description" class="repo-description"></p>
      <div id="repo-stats" class="repo-stats"></div>
    </header>
    <section id="languages-section" class="languages-section">
      <h2>Languages</h2>
      <div id="languages-bar" class="languages-bar"></div>
      <div id="languages-list" class="languages-list"></div>
    </section>
    <section id="files-section" class="files-section">
      <h2>Top Files</h2>
      <ul id="files-list" class="files-list"></ul>
    </section>
    <section id="readme-section" class="readme-section">
      <h2>README</h2>
      <div id="readme-content" class="markdown-body"></div>
    </section>
    <section id="release-section" class="release-section" style="display: none;">
      <h2>Latest Release</h2>
      <div id="latest-release" class="latest-release"></div>
    </section>
    <section id="contributors-section" class="contributors-section">
      <h2>Contributors</h2>
      <div id="contributors-list" class="contributors-list"></div>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
