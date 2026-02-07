import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequest, CommitStatus } from '../../models/pullRequest';
import { logDebug, logInfo, logError } from '../../utils/logger';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'checkout' }
  | { type: 'refresh' }
  | { type: 'merge'; strategy: string; message?: string }
  | { type: 'revert'; commitSha: string }
  | { type: 'addComment'; body: string }
  | { type: 'addReview'; state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'viewCommit'; sha: string }
  | { type: 'viewFile'; filename: string };

export type ExtensionMessage =
  | { type: 'update'; data: PRDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'actionComplete'; action: string; success: boolean };

export interface PRActivity {
  type: 'comment' | 'review' | 'commit' | 'timeline';
  id: number;
  created_at?: string;
  submitted_at?: string;
  committed_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  state?: string;
  sha?: string;
  message?: string;
  event?: string;
  commit_id?: string;
  html_url?: string;
}

export interface PRDetailViewData {
  pr: PullRequest;
  activities: PRActivity[];
  statuses: CommitStatus[];
  owner: string;
  repo: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  number: number;
  isReady: boolean;
  pendingData?: PRDetailViewData | null;
}

export class PRDetailWebviewProvider {
  public static readonly viewType = 'forgejo.prDetail';
  private _panels = new Map<string, PanelState>();

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async showPRDetails(owner: string, repo: string, number: number): Promise<void> {
    logInfo('Showing PR details in webview:', { owner, repo, number });

    const panelKey = `${owner}/${repo}/${number}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey)!;
      state.panel.reveal(vscode.ViewColumn.One);
      await this._loadPRData(panelKey);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PRDetailWebviewProvider.viewType,
      `PR #${number}: ${owner}/${repo}`,
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
      logInfo('Webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    this._fetchPRData(panelKey);
  }

  private async _fetchPRData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number } = state;
    logInfo('_fetchPRData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching PR details from API...');
      const prDetails = await client.getPullRequestDetails(owner, repo, number);
      logInfo('PR details fetched:', { title: prDetails.title });

      const [activities, statuses] = await Promise.all([
        this._fetchActivities(client, owner, repo, number),
        prDetails.head?.sha ? client.getCommitStatuses(owner, repo, prDetails.head.sha) : Promise.resolve([])
      ]);
      logInfo('Activities and statuses fetched:', { activities: activities.length, statuses: statuses.length });

      state.pendingData = { pr: prDetails, activities, statuses, owner, repo };
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        await this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      logError('Failed to fetch PR data:', error);
      if (state.isReady) {
        panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load PR details'
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
    logInfo('Posting messages to webview:', { prTitle: state.pendingData.pr.title });
    panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    panel.webview.postMessage({ type: 'loading', show: true });
    panel.webview.postMessage({ type: 'update', data: state.pendingData });
    panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadPRData(panelKey: string): Promise<void> {
    await this._fetchPRData(panelKey);
  }

  private async _fetchActivities(client: ForgejoClient, owner: string, repo: string, number: number): Promise<PRActivity[]> {
    const activities: PRActivity[] = [];
    try {
      const comments = await client.getIssueComments(owner, repo, number);
      activities.push(...comments.map((c: any) => ({ ...c, type: 'comment' as const })));
    } catch (e) { logDebug('Could not fetch comments:', e); }
    try {
      const reviews = await client.getPullRequestReviews(owner, repo, number);
      activities.push(...reviews.map((r: any) => ({ ...r, type: 'review' as const })));
    } catch (e) { logDebug('Could not fetch reviews:', e); }
    try {
      const commits = await client.getPullRequestCommits(owner, repo, number);
      activities.push(...commits.map((c: any) => ({ ...c, type: 'commit' as const })));
    } catch (e) { logDebug('Could not fetch commits:', e); }
    try {
      const timeline = await client.getIssueTimeline(owner, repo, number);
      activities.push(...timeline.map((t: any) => ({ ...t, type: 'timeline' as const })));
    } catch (e) { logDebug('Could not fetch timeline:', e); }
    return activities.sort((a, b) => {
      const dateA = new Date(a.created_at || a.submitted_at || a.committed_at || 0);
      const dateB = new Date(b.created_at || b.submitted_at || b.committed_at || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { panel, owner, repo, number } = state;

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
      case 'checkout': await this._checkoutBranch(owner, repo, number); break;
      case 'refresh': await this._fetchPRData(panelKey); break;
      case 'merge': await this._mergePR(owner, repo, number, message.strategy, message.message, panelKey); break;
      case 'revert': await this._revertCommit(message.commitSha); break;
      case 'addComment': await this._addComment(owner, repo, number, message.body, panelKey); break;
      case 'addReview': await this._addReview(owner, repo, number, message.state, message.body, panelKey); break;
      case 'openInBrowser': await this._openInBrowser(owner, repo, number); break;
    }
  }

  private async _checkoutBranch(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const refs = await client.getPullRequestRefs(owner, repo, number);
      const terminal = vscode.window.createTerminal('Forgejo Checkout');
      terminal.sendText(`git fetch origin ${refs.head}:${refs.head}`);
      terminal.sendText(`git checkout ${refs.head}`);
      terminal.show();
      vscode.window.showInformationMessage(`Checked out branch: ${refs.head}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to checkout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _mergePR(owner: string, repo: string, number: number, strategy: string, message?: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.mergePullRequest(owner, repo, number, strategy as any, false);
      vscode.window.showInformationMessage('Pull request merged successfully');
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: false });
      }
    }
  }

  private async _revertCommit(commitSha: string): Promise<void> {
    const terminal = vscode.window.createTerminal('Forgejo Revert');
    terminal.sendText(`git revert ${commitSha}`);
    terminal.show();
  }

  private async _addComment(owner: string, repo: string, number: number, body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      vscode.window.showInformationMessage('Comment added');
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: false });
      }
    }
  }

  private async _addReview(owner: string, repo: string, number: number, reviewState: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createReview(owner, repo, number, reviewState, body);
      vscode.window.showInformationMessage(`Review ${reviewState.toLowerCase().replace(/_/g, ' ')}`);
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add review: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: false });
      }
    }
  }

  private async _openInBrowser(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${owner}/${repo}/pulls/${number}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'index.js'));

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
  <title>PR Details</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <p>Loading pull request details...</p>
  </div>

  <div id="error" class="error" style="display: none;">
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <header class="pr-header">
      <div class="pr-title-row">
        <h1 id="pr-title"></h1>
        <span id="pr-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>
      
      <div class="pr-meta">
        <span id="pr-status-badge" class="status-badge"></span>
        <span class="pr-author">
          by <img id="author-avatar" src="" alt="" class="avatar" style="display:none">
          <span id="author-name"></span>
        </span>
        <span class="pr-branch">
          <span id="base-branch"></span>
          <span class="branch-arrow">←</span>
          <span id="head-branch"></span>
        </span>
      </div>
    </header>

    <nav class="action-bar">
      <button id="checkout-btn" class="btn btn-primary">Checkout</button>
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
      <button id="add-comment-btn" class="btn btn-secondary">+ Comment</button>
      <div id="merge-actions" class="merge-actions" style="display: none;">
        <button id="merge-btn" class="btn btn-success">Merge</button>
      </div>
      <div id="revert-actions" class="revert-actions" style="display: none;">
        <button id="revert-btn" class="btn btn-danger">Revert</button>
      </div>
    </nav>

    <section class="description-section">
      <h2>Description</h2>
      <div id="pr-description" class="markdown-body"></div>
    </section>

    <section id="ci-section" class="ci-section" style="display: none;">
      <h2>CI Status</h2>
      <div id="ci-status-list"></div>
    </section>

    <section class="activity-section">
      <h2>Activity <span id="activity-count"></span></h2>
      <div id="activity-timeline"></div>
    </section>

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
      <textarea id="review-body" placeholder="Review comment..."></textarea>
      <div class="review-actions">
        <button id="submit-review-btn" class="btn btn-primary">Submit Review</button>
        <button id="cancel-review-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <div id="merge-dialog" class="merge-dialog" style="display: none;">
      <h3>Merge Pull Request</h3>
      <select id="merge-strategy">
        <option value="merge">Create a merge commit</option>
        <option value="squash">Squash and merge</option>
        <option value="rebase">Rebase and merge</option>
      </select>
      <textarea id="merge-message" placeholder="Merge message (optional)"></textarea>
      <div class="merge-actions">
        <button id="confirm-merge-btn" class="btn btn-success">Merge</button>
        <button id="cancel-merge-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
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
