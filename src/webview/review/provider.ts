import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequestFile } from '../../models/pullRequest';
import { logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type ReviewWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openFile'; filename: string; status: string; additions: number; deletions: number; changes: number; owner: string; repo: string; baseRef: string; headRef: string }
  | { type: 'addComment'; body: string }
  | { type: 'addReview'; state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string };

export type ReviewExtensionMessage =
  | { type: 'update'; data: ReviewViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'actionComplete'; action: string; success: boolean };

export interface ReviewViewData {
  pr: { number: number; title: string };
  files: PullRequestFile[];
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  number: number;
  isReady: boolean;
  pendingData?: ReviewViewData | null;
  lastRequestId: number;
}

export class ReviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.review';
  public readonly viewType = 'forgejo.review';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async show(owner: string, repo: string, number: number): Promise<void> {
    logInfo('Showing PR review webview:', { owner, repo, number });

    const panelKey = `${owner}/${repo}/${String(number)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReviewProvider.viewType,
      `PR #${String(number)}: Files changed`,
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
      number,
      isReady: false,
      pendingData: null,
      lastRequestId: 0
    };
    this._panels.set(panelKey, state);

    panel.webview.html = this._getHtmlForWebview(panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this._handleMessage(message as ReviewWebviewMessage, panelKey);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      logInfo('Review webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    void this._fetchData(panelKey);
  }

  private async _fetchData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number } = state;

    const data = await this._runGuarded(state, async () => {
      try {
        const config = await getForgejoConfig();
        if (!config) throw new Error('Forgejo configuration not found');

        const client = new ForgejoClient(config.instanceUrl, config.token);

        const [files, refs, prDetails] = await Promise.all([
          client.getPullRequestFiles(owner, repo, number),
          client.getPullRequestRefs(owner, repo, number),
          client.getPullRequestDetails(owner, repo, number)
        ]);

        return {
          pr: { number, title: prDetails.title || '' },
          files,
          owner,
          repo,
          baseRef: refs.base,
          headRef: refs.head
        } as ReviewViewData;
      } catch (error) {
        logError('Failed to fetch PR review data:', error);
        if (state.isReady) {
          void panel.webview.postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to load PR files'
          });
        }
        return null;
      }
    });

    if (!data) return; // fetch failed (error already posted) or superseded
    state.pendingData = data;
    if (state.isReady) {
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

  private async _loadData(panelKey: string): Promise<void> {
    await this._fetchData(panelKey);
  }

  private async _handleMessage(message: ReviewWebviewMessage, panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    // Generic message types (openUserProfile / openInBrowserFromUrl / log / …)
    if (await this._handleBaseMessage(message, state.panel.webview)) return;

    switch (message.type) {
      case 'ready':
        state.isReady = true;
        if (state.pendingData) {
          this._sendDataToPanel(panelKey);
        }
        break;

      case 'refresh':
        await this._fetchData(panelKey);
        break;

      case 'openFile':
        await vscode.commands.executeCommand(
          'forgejo.showPrFileDiff',
          {
            filename: message.filename,
            status: message.status,
            additions: message.additions,
            deletions: message.deletions,
            changes: message.changes,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          } as PullRequestFile,
          { number: state.number, title: '', state: 'open', user: { login: '' }, html_url: '', created_at: '', merged: false, draft: false },
          message.owner,
          message.repo,
          message.baseRef,
          message.headRef
        );
        break;

      case 'addComment':
        await this._addComment(state.owner, state.repo, state.number, message.body, panelKey);
        break;

      case 'addReview':
        await this._addReview(state.owner, state.repo, state.number, message.state, message.body, panelKey);
        break;
    }
  }

  private async _addComment(owner: string, repo: string, number: number, body: string, panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      void vscode.window.showInformationMessage('Comment added');
      if (state) {
        void state.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: true });
      }
      await this._fetchData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (state) {
        void state.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: false });
      }
    }
  }

  private async _addReview(owner: string, repo: string, number: number, reviewState: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createReview(owner, repo, number, reviewState, body);
      void vscode.window.showInformationMessage(`Review submitted (${reviewState.toLowerCase().replace('_', ' ')})`);
      if (state) {
        void state.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: true });
      }
      await this._fetchData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to submit review: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (state) {
        void state.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: false });
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'review', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'review', 'index.js'));

    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>PR Review</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line short"></div>
    <div class="skeleton skeleton-line short"></div>
  </div>

  <div id="error" class="error" style="display: none;">
    <span class="error-icon codicon codicon-error" aria-hidden="true"></span>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="review-header">
      <h1 id="review-title"></h1>
      <div class="review-summary" id="review-summary"></div>
    </header>
    <div class="review-actions">
      <button id="refresh-btn" class="btn btn-secondary"><span class="codicon codicon-refresh" aria-hidden="true"></span> Refresh</button>
      <button id="add-comment-btn" class="btn btn-secondary"><span class="codicon codicon-comment" aria-hidden="true"></span> Comment</button>
      <button id="add-review-btn" class="btn btn-secondary"><span class="codicon codicon-git-pull-request" aria-hidden="true"></span> Review</button>
    </div>

    <div id="comment-input-container" class="comment-input-container" style="display: none;">
      <textarea id="comment-input" placeholder="Write a comment..."></textarea>
      <div class="comment-actions">
        <button id="submit-comment-btn" class="btn btn-primary">Submit</button>
        <button id="cancel-comment-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <div id="review-dialog" class="review-dialog" style="display: none;">
      <h3>Submit Review</h3>
      <select id="review-state">
        <option value="COMMENT">Comment</option>
        <option value="APPROVE">Approve</option>
        <option value="REQUEST_CHANGES">Request Changes</option>
      </select>
      <textarea id="review-body" placeholder="Review summary..."></textarea>
      <div class="review-actions-bar">
        <button id="submit-review-btn" class="btn btn-primary">Submit Review</button>
        <button id="cancel-review-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <div id="file-list" class="file-list"></div>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
