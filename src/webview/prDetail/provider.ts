import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequest, CommitStatus } from '../../models/pullRequest';
import { logDebug, logInfo, logError } from '../../utils/logger';

/**
 * Message types for communication between extension and webview
 */
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
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' };

/**
 * Activity item in the PR timeline
 */
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

/**
 * Data structure for the PR detail view
 */
export interface PRDetailViewData {
  pr: PullRequest;
  activities: PRActivity[];
  statuses: CommitStatus[];
  owner: string;
  repo: string;
}

/**
 * Provider for the rich PR detail webview
 */
export class PRDetailWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'forgejo.prDetail';
  private _view?: vscode.WebviewView;
  private _currentPR?: { owner: string; repo: string; number: number };
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Resolve the webview view
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Set up message handler
    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        await this._handleMessage(message);
      },
      undefined,
      this._disposables
    );

    // Listen for theme changes
    this._disposables.push(
      vscode.window.onDidChangeActiveColorTheme(theme => {
        this._postMessage({
          type: 'theme',
          theme: this._getThemeName(theme.kind)
        });
      })
    );
  }

  /**
   * Show PR details in the webview
   */
  public async showPRDetails(owner: string, repo: string, number: number): Promise<void> {
    logInfo('Showing PR details in webview:', { owner, repo, number });

    this._currentPR = { owner, repo, number };

    if (this._view) {
      this._view.show?.(true);
      this._postMessage({ type: 'loading', show: true });
    }

    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);

      // Fetch PR details first
      const prDetails = await client.getPullRequestDetails(owner, repo, number);

      // Fetch all data in parallel
      const [activities, statuses] = await Promise.all([
        this._fetchActivities(client, owner, repo, number),
        prDetails.head?.sha
          ? client.getCommitStatuses(owner, repo, prDetails.head.sha)
          : Promise.resolve([])
      ]);

      const data: PRDetailViewData = {
        pr: prDetails,
        activities,
        statuses,
        owner,
        repo
      };

      this._postMessage({
        type: 'update',
        data
      });
    } catch (error) {
      logError('Failed to load PR details:', error);
      this._postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load PR details'
      });
    } finally {
      this._postMessage({ type: 'loading', show: false });
    }
  }

  /**
   * Fetch all PR activities (comments, reviews, commits, timeline events)
   */
  private async _fetchActivities(
    client: ForgejoClient,
    owner: string,
    repo: string,
    number: number
  ): Promise<PRActivity[]> {
    const activities: PRActivity[] = [];

    try {
      // Fetch comments
      const comments = await client.getIssueComments(owner, repo, number);
      activities.push(...comments.map((c: any) => ({ ...c, type: 'comment' as const })));
    } catch (error) {
      logDebug('Could not fetch comments:', error);
    }

    try {
      // Fetch reviews
      const reviews = await client.getPullRequestReviews(owner, repo, number);
      activities.push(...reviews.map((r: any) => ({ ...r, type: 'review' as const })));
    } catch (error) {
      logDebug('Could not fetch reviews:', error);
    }

    try {
      // Fetch commits
      const commits = await client.getPullRequestCommits(owner, repo, number);
      activities.push(...commits.map((c: any) => ({ ...c, type: 'commit' as const })));
    } catch (error) {
      logDebug('Could not fetch commits:', error);
    }

    try {
      // Fetch timeline events
      const timeline = await client.getIssueTimeline(owner, repo, number);
      activities.push(...timeline.map((t: any) => ({ ...t, type: 'timeline' as const })));
    } catch (error) {
      logDebug('Could not fetch timeline:', error);
    }

    // Sort by date (newest first)
    return activities.sort((a, b) => {
      const dateA = new Date(a.created_at || a.submitted_at || a.committed_at || 0);
      const dateB = new Date(b.created_at || b.submitted_at || b.committed_at || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }

  /**
   * Handle messages from the webview
   */
  private async _handleMessage(message: WebviewMessage): Promise<void> {
    logDebug('Received message from webview:', message);

    if (!this._currentPR) {
      vscode.window.showErrorMessage('No PR is currently loaded');
      return;
    }

    const { owner, repo, number } = this._currentPR;

    switch (message.type) {
      case 'ready':
        // Webview is ready, send initial theme
        this._postMessage({
          type: 'theme',
          theme: this._getThemeName(vscode.window.activeColorTheme.kind)
        });
        break;

      case 'checkout':
        await this._checkoutBranch(owner, repo, number);
        break;

      case 'refresh':
        await this.showPRDetails(owner, repo, number);
        break;

      case 'merge':
        await this._mergePR(owner, repo, number, message.strategy, message.message);
        break;

      case 'revert':
        await this._revertCommit(message.commitSha);
        break;

      case 'addComment':
        await this._addComment(owner, repo, number, message.body);
        break;

      case 'addReview':
        await this._addReview(owner, repo, number, message.state, message.body);
        break;

      case 'openInBrowser':
        await this._openInBrowser(owner, repo, number);
        break;

      case 'viewCommit':
        // Open commit in browser or git view
        vscode.env.openExternal(vscode.Uri.parse(`https://${owner}/${repo}/commit/${message.sha}`));
        break;

      case 'viewFile':
        // Open file diff
        vscode.commands.executeCommand('forgejo.showPrFileDiff', owner, repo, number, message.filename);
        break;
    }
  }

  /**
   * Checkout the PR branch
   */
  private async _checkoutBranch(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const refs = await client.getPullRequestRefs(owner, repo, number);

      // Execute git checkout via VS Code API
      const terminal = vscode.window.createTerminal('Forgejo Checkout');
      terminal.sendText(`git fetch origin ${refs.head}:${refs.head}`);
      terminal.sendText(`git checkout ${refs.head}`);
      terminal.show();

      vscode.window.showInformationMessage(`Checked out branch: ${refs.head}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to checkout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Merge the PR
   */
  private async _mergePR(
    owner: string,
    repo: string,
    number: number,
    strategy: string,
    message?: string
  ): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.mergePullRequest(owner, repo, number, strategy as any, false);

      vscode.window.showInformationMessage('Pull request merged successfully');
      await this.showPRDetails(owner, repo, number);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Revert a commit
   */
  private async _revertCommit(commitSha: string): Promise<void> {
    const terminal = vscode.window.createTerminal('Forgejo Revert');
    terminal.sendText(`git revert ${commitSha}`);
    terminal.show();
  }

  /**
   * Add a comment to the PR
   */
  private async _addComment(owner: string, repo: string, number: number, body: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);

      vscode.window.showInformationMessage('Comment added');
      await this.showPRDetails(owner, repo, number);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add a review to the PR
   */
  private async _addReview(
    owner: string,
    repo: string,
    number: number,
    state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body: string
  ): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createReview(owner, repo, number, state, body);

      vscode.window.showInformationMessage(`Review ${state.toLowerCase().replace('_', ' ')}`);
      await this.showPRDetails(owner, repo, number);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add review: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Open PR in browser
   */
  private async _openInBrowser(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const url = `${config.instanceUrl}/${owner}/${repo}/pulls/${number}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open in browser: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Post a message to the webview
   */
  private _postMessage(message: ExtensionMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Get theme name from VS Code color theme kind
   */
  private _getThemeName(kind: vscode.ColorThemeKind): 'light' | 'dark' | 'high-contrast' {
    switch (kind) {
      case vscode.ColorThemeKind.Light:
        return 'light';
      case vscode.ColorThemeKind.HighContrast:
        return 'high-contrast';
      case vscode.ColorThemeKind.HighContrastLight:
        return 'high-contrast';
      default:
        return 'dark';
    }
  }

  /**
   * Generate HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'prDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'prDetail', 'index.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    <button id="retry-btn">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <!-- Header Section -->
    <header class="pr-header">
      <div class="pr-title-row">
        <h1 id="pr-title"></h1>
        <span id="pr-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>
      
      <div class="pr-meta">
        <span id="pr-status-badge" class="status-badge"></span>
        <span class="pr-author">
          by <img id="author-avatar" src="" alt="" class="avatar">
          <span id="author-name"></span>
        </span>
        <span class="pr-branch">
          <span id="base-branch"></span>
          <span class="branch-arrow">←</span>
          <span id="head-branch"></span>
        </span>
      </div>
    </header>

    <!-- Action Bar -->
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

    <!-- Description Section -->
    <section class="description-section">
      <h2>Description</h2>
      <div id="pr-description" class="markdown-body"></div>
    </section>

    <!-- CI Status Section -->
    <section id="ci-section" class="ci-section" style="display: none;">
      <h2>CI Status</h2>
      <div id="ci-status-list"></div>
    </section>

    <!-- Activity Timeline -->
    <section class="activity-section">
      <h2>Activity <span id="activity-count"></span></h2>
      <div id="activity-timeline"></div>
    </section>

    <!-- Comment Input -->
    <div id="comment-input-container" class="comment-input-container" style="display: none;">
      <textarea id="comment-input" placeholder="Write a comment..."></textarea>
      <div class="comment-actions">
        <button id="submit-comment-btn" class="btn btn-primary">Submit</button>
        <button id="cancel-comment-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>

    <!-- Review Dialog -->
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

    <!-- Merge Dialog -->
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

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }
}
