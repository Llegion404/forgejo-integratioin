import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequest, CommitStatus } from '../../models/pullRequest';
import { Reaction } from '../../models/comment';
import { executeCommand } from '../../commands/registry';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'checkout' }
  | { type: 'refresh' }
  | { type: 'merge'; strategy: string; title?: string; message?: string; deleteBranch?: boolean }
  | { type: 'revert'; commitSha: string }
  | { type: 'addComment'; body: string }
  | { type: 'addReview'; state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'viewCommit'; sha: string }
  | { type: 'viewFile'; filename: string }
  | { type: 'updateBody'; body: string }
  | { type: 'openCIStatus'; url: string }
  | { type: 'addReaction'; commentId: number; reaction: string }
  | { type: 'removeReaction'; commentId: number; reaction: string }
  | { type: 'addPRReaction'; reaction: string }
  | { type: 'removePRReaction'; reaction: string }
  | { type: 'openUserProfile'; username: string }
  | { type: 'openInBrowserFromUrl'; url: string }
  | { type: 'editComment'; commentId: number; body: string }
  | { type: 'replyToComment'; body: string; replyToUser: string; originalBody: string }
  | { type: 'reopenPR' }
  | { type: 'toggleDraft' }
  | { type: 'updateTitle'; title: string }
  | { type: 'deleteComment'; commentId: number }
  | { type: 'manageLabels' }
  | { type: 'manageAssignees' }
  | { type: 'manageReviewers' }
  | { type: 'removeLabel'; label: string }
  | { type: 'removeAssignee'; assignee: string }
  | { type: 'removeReviewer'; reviewer: string }
  | { type: 'manageMilestone' }
  | { type: 'showConfirm'; id: number; message: string }
  | { type: 'showInputBox'; id: number; prompt: string; defaultValue?: string };

export type ExtensionMessage =
  | { type: 'update'; data: PRDetailViewData }
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'actionComplete'; action: string; success: boolean }
  | { type: 'bodyUpdated'; body: string };

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
  reactions?: Reaction[];
}

export interface PRDetailViewData {
  pr: PullRequest;
  activities: PRActivity[];
  statuses: CommitStatus[];
  prReactions: Reaction[];
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
  lastRequestId: number;
}

export class PRDetailWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.prDetail';
  public readonly viewType = 'forgejo.prDetail';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showPRDetails(owner: string, repo: string, number: number): Promise<void> {
    logInfo('Showing PR details in webview:', { owner, repo, number });

    const panelKey = `${owner}/${repo}/${String(number)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadPRData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PRDetailWebviewProvider.viewType,
      `PR #${String(number)}: ${owner}/${repo}`,
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
        void this._handleMessage(message as WebviewMessage, panelKey);
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      logInfo('Webview panel disposed:', panelKey);
      this._panels.delete(panelKey);
    }, undefined, []);

    void this._fetchPRData(panelKey);
  }

  private async _fetchPRData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const requestId = ++state.lastRequestId;
    const { panel, owner, repo, number } = state;
    logInfo('_fetchPRData starting:', { panelKey, isReady: state.isReady, requestId });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching PR details from API...');
      const prDetails = await client.getPullRequestDetails(owner, repo, number);
      if (requestId !== state.lastRequestId) {
        logInfo('PR fetch superseded by newer request, ignoring', { requestId });
        return;
      }
      logInfo('PR details fetched:', { title: prDetails.title });

      const [activities, allStatuses] = await Promise.all([
        this._fetchActivities(client, owner, repo, number),
        prDetails.head.sha ? client.getCommitStatuses(owner, repo, prDetails.head.sha) : Promise.resolve([])
      ]);
      if (requestId !== state.lastRequestId) {
        logInfo('PR fetch (activities+statuses) superseded, ignoring', { requestId });
        return;
      }

      // Fetch description-level reactions (Forgejo treats PR as issue ID)
      let prReactions: Reaction[] = [];
      try {
        prReactions = await client.getIssueReactions(owner, repo, prDetails.id);
      } catch (e) { logDebug('Could not fetch PR-level reactions:', e); }
      if (requestId !== state.lastRequestId) {
        logInfo('PR fetch (reactions) superseded, ignoring', { requestId });
        return;
      }

      // Deduplicate statuses by context, keeping only the latest per context.
      // The API returns all historical statuses (pending + final) for a SHA.
      // Each status update creates a new record with a new created_at timestamp.
      const latestByContext = new Map<string, typeof allStatuses[0]>();
      for (const status of allStatuses) {
        const key = status.context;
        const statusDate = new Date(status.created_at).getTime();
        if (isNaN(statusDate)) continue;
        const existing = latestByContext.get(key);
        const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
        if (statusDate > existingDate) {
          latestByContext.set(key, status);
        }
      }
      const statuses = Array.from(latestByContext.values());
      logInfo('Activities and statuses fetched:', { activities: activities.length, statuses: statuses.length, raw: allStatuses.length });

      state.pendingData = { pr: prDetails, activities, statuses, prReactions, owner, repo };
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      logError('Failed to fetch PR data:', error);
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load PR details'
        });
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
    logInfo('Posting messages to webview:', { prTitle: state.pendingData.pr.title });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadPRData(panelKey: string): Promise<void> {
    await this._fetchPRData(panelKey);
  }

  private async _fetchActivities(client: ForgejoClient, owner: string, repo: string, number: number): Promise<PRActivity[]> {
    const activities: PRActivity[] = [];
    let comments: PRActivity[] = [];
    try {
      const rawComments = await client.getIssueComments(owner, repo, number);
      comments = (rawComments as PRActivity[]).map((c) => ({ ...c, type: 'comment' as const }));
      // Fetch reactions for each comment
      await Promise.all(comments.map(async (c) => {
        try {
          const reactions = await client.getCommentReactions(owner, repo, c.id);
          c.reactions = reactions;
        } catch (e) { logDebug('Could not fetch reactions for comment:', c.id, e); }
      }));
      activities.push(...comments);
    } catch (e) { logDebug('Could not fetch comments:', e); }
    try {
      const reviews = await client.getPullRequestReviews(owner, repo, number);
      activities.push(...(reviews as PRActivity[]).map((r) => ({ ...r, type: 'review' as const })));
    } catch (e) { logDebug('Could not fetch reviews:', e); }
    try {
      const commits = await client.getPullRequestCommits(owner, repo, number);
      activities.push(...(commits as any[]).map((c) => ({
        ...c,
        type: 'commit' as const,
        user: c.author || { login: 'Unknown' },
        message: c.commit?.message || '',
        committed_at: c.commit?.author?.date,
        created_at: c.commit?.author?.date,
      })));
    } catch (e) { logDebug('Could not fetch commits:', e); }
    try {
      const timeline = await client.getIssueTimeline(owner, repo, number);
      // Filter out comment events to avoid duplicating entries already fetched via getIssueComments.
      // Forgejo API returns event type as `type`; map it to `event` for the webview before overwriting `type`.
      activities.push(...(timeline as any[]).filter((t) => (t.type || t.event) !== 'comment').map((t) => ({ ...t, event: t.type || t.event, type: 'timeline' as const })));
    } catch (e) { logDebug('Could not fetch timeline:', e); }
    return activities.sort((a, b) => {
      const dateA = new Date(a.created_at ?? a.submitted_at ?? a.committed_at ?? 0);
      const dateB = new Date(b.created_at ?? b.submitted_at ?? b.committed_at ?? 0);
      return dateA.getTime() - dateB.getTime();
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
          this._sendDataToPanel(panelKey);
        } else {
          logInfo('No pending data yet, showing loading state');
          void panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'checkout': await this._checkoutBranch(owner, repo, number); break;
      case 'refresh': await this._fetchPRData(panelKey); break;
      case 'merge': await this._mergePR(owner, repo, number, message.strategy, message.title, message.message, message.deleteBranch, panelKey); break;
      case 'revert': this._revertCommit(message.commitSha); break;
      case 'addComment': await this._addComment(owner, repo, number, message.body, panelKey); break;
      case 'addReview': await this._addReview(owner, repo, number, message.state, message.body, panelKey); break;
      case 'openInBrowser': await this._openInBrowser(owner, repo, number); break;
      case 'updateBody': await this._updateBody(owner, repo, number, message.body, panelKey); break;
      case 'openCIStatus':
        if (message.url) {
          await this._openCIStatus(message.url, owner, repo);
        }
        break;
      case 'addReaction':
        await this._handleReaction(owner, repo, message.commentId, message.reaction, 'add', panelKey);
        break;
      case 'removeReaction':
        await this._handleReaction(owner, repo, message.commentId, message.reaction, 'remove', panelKey);
        break;
      case 'addPRReaction':
        await this._handlePRReaction(owner, repo, number, message.reaction, 'add', panelKey);
        break;
      case 'removePRReaction':
        await this._handlePRReaction(owner, repo, number, message.reaction, 'remove', panelKey);
        break;
      case 'openUserProfile':
        await this._openUserProfile(message.username);
        break;
      case 'openInBrowserFromUrl':
        this._openUrl(message.url);
        break;
      case 'editComment':
        await this._handleEditComment(owner, repo, message.commentId, message.body, panelKey);
        break;
      case 'replyToComment': await this._replyToComment(owner, repo, number, message.body, panelKey); break;
      case 'reopenPR': await this._reopenPR(owner, repo, number, panelKey); break;
      case 'toggleDraft': await this._toggleDraft(owner, repo, number, panelKey); break;
      case 'updateTitle': await this._updateTitle(owner, repo, number, message.title, panelKey); break;
      case 'deleteComment': await this._deleteComment(owner, repo, message.commentId, panelKey); break;
      case 'manageLabels': await this._manageLabels(owner, repo, number, panelKey); break;
      case 'manageAssignees': await this._manageAssignees(owner, repo, number, panelKey); break;
      case 'manageReviewers': await this._manageReviewers(owner, repo, number, panelKey); break;
      case 'removeLabel': await this._removeLabel(owner, repo, number, message.label, panelKey); break;
      case 'removeAssignee': await this._removeAssignee(owner, repo, number, message.assignee, panelKey); break;
      case 'removeReviewer': await this._removeReviewer(owner, repo, number, message.reviewer, panelKey); break;
      case 'manageMilestone': await this._manageMilestone(owner, repo, number, panelKey); break;
      case 'viewCommit': await this._viewCommit(owner, repo, message.sha); break;
      case 'viewFile': await this._viewFile(owner, repo, number, message.filename); break;
      case 'showConfirm': await this._handleShowConfirm(state.panel.webview, message.id, message.message); break;
      case 'showInputBox': await this._handleShowInputBox(state.panel.webview, message.id, message.prompt, message.defaultValue); break;
    }
  }

  private async _openCIStatus(url: string, owner: string, repo: string): Promise<void> {
    // Check if this is a Forgejo Actions URL (e.g., /owner/repo/actions/runs/283/jobs/1)
    // These URLs are relative paths from the Forgejo instance
    const actionsMatch = url.match(/\/[^/]+\/[^/]+\/actions\/runs\/(\d+)(?:\/jobs\/(\d+))?/);
    if (actionsMatch) {
      const runNumber = parseInt(actionsMatch[1], 10);
      try {
        const config = await getForgejoConfig();
        if (!config) throw new Error('No config');

        // Fetch workflow runs and find the matching one by run_number
        const client = new ForgejoClient(config.instanceUrl, config.token);
        const response = await client.getWorkflowRuns(owner, repo);
        const matchingRun = response.workflow_runs.find(r => r.run_number === runNumber);

        if (matchingRun) {
          // Deep-link to the action detail webview within the extension
          await executeCommand('forgejo.showActionDetails', matchingRun, owner, repo);
          return;
        }
      } catch (error) {
        logError('Failed to open CI status in extension:', error);
      }
    }

    // Fallback: open in browser, fixing relative URLs
    try {
      let fullUrl = url;
      if (url.startsWith('/')) {
        const config = await getForgejoConfig();
        if (config?.instanceUrl) {
          fullUrl = `${config.instanceUrl}${url}`;
        }
      }
      void vscode.env.openExternal(vscode.Uri.parse(fullUrl));
    } catch (error) {
      logError('Failed to open CI status URL:', error);
    }
  }

  private async _handleReaction(owner: string, repo: string, commentId: number, reaction: string, action: 'add' | 'remove', panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      if (action === 'add') {
        await client.addCommentReaction(owner, repo, commentId, reaction);
      } else {
        await client.deleteCommentReaction(owner, repo, commentId, reaction);
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to ${action} reaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _handlePRReaction(owner: string, repo: string, number: number, reaction: string, action: 'add' | 'remove', panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      if (action === 'add') {
        await client.addIssueReaction(owner, repo, number, reaction);
      } else {
        await client.deleteIssueReaction(owner, repo, number, reaction);
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to ${action} PR reaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openUserProfile(username: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${encodeURIComponent(username)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _openUrl(url: string): void {
    try {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      logError('Failed to open URL:', error);
    }
  }

  private async _handleEditComment(owner: string, repo: string, commentId: number, body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateComment(owner, repo, commentId, body);
      void vscode.window.showInformationMessage('Comment updated');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'editComment', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to update comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'editComment', success: false });
      }
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
      void vscode.window.showInformationMessage(`Checked out branch: ${refs.head}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to checkout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _mergePR(owner: string, repo: string, number: number, strategy: string, mergeTitle?: string, mergeMessage?: string, deleteBranch?: boolean, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.mergePullRequestWithMessage(
        owner, repo, number,
        strategy as 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only',
        mergeTitle ?? '',
        mergeMessage ?? '',
        deleteBranch === true
      );
      void vscode.window.showInformationMessage('Pull request merged successfully');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'merge', success: false });
      }
    }
  }

  private _revertCommit(commitSha: string): void {
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
      void vscode.window.showInformationMessage('Comment added');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: false });
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
      void vscode.window.showInformationMessage(`Review ${reviewState.toLowerCase().replace(/_/g, ' ')}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: true });
      }
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add review: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addReview', success: false });
      }
    }
  }

  private async _updateBody(owner: string, repo: string, number: number, body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const updatedPR = await client.updatePullRequestBody(owner, repo, number, body);
      logInfo('PR body updated:', { owner, repo, number });
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'bodyUpdated', body: updatedPR.body });
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: true });
      }
      if (panelState?.pendingData) {
        panelState.pendingData.pr.body = updatedPR.body;
      }
    } catch (error) {
      logError('Failed to update PR body:', error);
      void vscode.window.showErrorMessage(`Failed to update description: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: false });
      }
    }
  }

  private async _reopenPR(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updatePullRequestState(owner, repo, number, 'open');
      void vscode.window.showInformationMessage(`PR #${String(number)} reopened`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to reopen PR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _toggleDraft(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const state = this._panels.get(panelKey ?? '');
      const isDraft = state?.pendingData?.pr.draft ?? true;
      await client.togglePullRequestDraft(owner, repo, number, !isDraft);
      void vscode.window.showInformationMessage(isDraft ? 'PR marked as ready for review' : 'PR converted to draft');
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to toggle draft: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _updateTitle(owner: string, repo: string, number: number, title: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updatePullRequest(owner, repo, number, { title });
      void vscode.window.showInformationMessage('Title updated');
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to update title: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _deleteComment(owner: string, repo: string, commentId: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.deleteComment(owner, repo, commentId);
      void vscode.window.showInformationMessage('Comment deleted');
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to delete comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _replyToComment(owner: string, repo: string, number: number, body: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      void vscode.window.showInformationMessage('Reply posted');
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to post reply: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _viewCommit(owner: string, repo: string, sha: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${owner}/${repo}/commit/${sha}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open commit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _viewFile(owner: string, repo: string, number: number, filename: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const pr = await client.getPullRequestDetails(owner, repo, number);
      const url = `${config.instanceUrl}/${owner}/${repo}/src/${pr.head.sha}/${filename}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _manageLabels(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const [repoLabels, prLabels] = await Promise.all([
        client.listRepoLabels(owner, repo),
        client.getPullRequestDetails(owner, repo, number).then(pr => (pr as any).labels ?? []).catch(() => [])
      ]);
      const currentLabelNames = new Set(prLabels.map((l: any) => l.name));

      const items = repoLabels.map(l => ({
        label: l.name,
        picked: currentLabelNames.has(l.name),
        description: `#${l.color}`,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Manage labels',
        title: `Labels for PR #${number}`,
      });
      if (!selected) return;

      const selectedNames = new Set(selected.map(s => s.label));
      const toAdd = selected.filter(s => !currentLabelNames.has(s.label)).map(s => s.label);
      const toRemove = prLabels.filter((l: any) => !selectedNames.has(l.name)).map((l: any) => l.name);

      if (toAdd.length > 0) await client.addPRLabels(owner, repo, number, toAdd);
      for (const label of toRemove) await client.removePRLabel(owner, repo, number, label);

      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to manage labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _manageAssignees(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const [assignees, pr] = await Promise.all([
        client.listRepoAssignees(owner, repo),
        client.getPullRequestDetails(owner, repo, number)
      ]);
      const currentAssignees = new Set<string>(((pr as any).assignees ?? []).map((a: any) => a.login as string));

      const items = assignees.map(a => ({
        label: a.login,
        picked: currentAssignees.has(a.login),
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Manage assignees',
        title: `Assignees for PR #${number}`,
      });
      if (!selected) return;

      const selectedNames = selected.map(s => s.label);
      const toAdd = selectedNames.filter(n => !currentAssignees.has(n));
      const toRemove = Array.from(currentAssignees).filter(n => !selectedNames.includes(n));

      if (toAdd.length > 0) await client.addPRAssignees(owner, repo, number, toAdd);
      if (toRemove.length > 0) await client.removePRAssignees(owner, repo, number, toRemove);

      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to manage assignees: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _manageReviewers(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const [assignees, pr] = await Promise.all([
        client.listRepoAssignees(owner, repo),
        client.getPullRequestDetails(owner, repo, number)
      ]);
      const currentReviewers = new Set<string>(((pr as any).requested_reviewers ?? []).map((r: any) => r.login as string));

      const items = assignees.map(a => ({
        label: a.login,
        picked: currentReviewers.has(a.login),
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Manage reviewers',
        title: `Reviewers for PR #${number}`,
      });
      if (!selected) return;

      const selectedNames = selected.map(s => s.label);
      const toAdd = selectedNames.filter(n => !currentReviewers.has(n));
      const toRemove = Array.from(currentReviewers).filter(n => !selectedNames.includes(n));

      if (toAdd.length > 0) {
        for (const reviewer of toAdd) await client.requestPRReview(owner, repo, number, reviewer);
      }
      if (toRemove.length > 0) {
        for (const reviewer of toRemove) await client.removePRReview(owner, repo, number, reviewer);
      }

      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to manage reviewers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removeLabel(owner: string, repo: string, number: number, label: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removePRLabel(owner, repo, number, label);
      void vscode.window.showInformationMessage(`Removed label: ${label}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove label: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removeAssignee(owner: string, repo: string, number: number, assignee: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removePRAssignees(owner, repo, number, [assignee]);
      void vscode.window.showInformationMessage(`Removed assignee: ${assignee}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removeReviewer(owner: string, repo: string, number: number, reviewer: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removePRReview(owner, repo, number, reviewer);
      void vscode.window.showInformationMessage(`Removed reviewer: ${reviewer}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove reviewer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _manageMilestone(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const [milestones, pr] = await Promise.all([
        client.listMilestones(owner, repo).catch(() => []),
        client.getPullRequestDetails(owner, repo, number)
      ]);
      const currentMilestoneId = (pr as any).milestone?.id;
      const items = [
        { label: 'No milestone', picked: !currentMilestoneId, description: '' },
        ...milestones.map((m: any) => ({
          label: m.title,
          picked: m.id === currentMilestoneId,
          description: m.due_on ? `due ${new Date(m.due_on).toLocaleDateString()}` : ''
        }))
      ];
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select milestone',
        title: `Milestone for PR #${number}`
      });
      if (!selected) return;
      const milestone = milestones.find((m: any) => m.title === selected.label);
      const milestoneId = milestone?.id ?? null;
      await client.updatePullRequest(owner, repo, number, { milestone: milestoneId } as any);
      void vscode.window.showInformationMessage(`Milestone set to: ${selected.label}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to manage milestone: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openInBrowser(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${owner}/${repo}/pulls/${String(number)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'prDetail', 'index.js'));

    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>PR Details</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-subtitle"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line short"></div>
    <div class="skeleton skeleton-line short"></div>
    <div class="skeleton-activity">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </div>
    <div class="skeleton-activity">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </div>
  </div>

  <div id="error" class="error" style="display: none;">
    <div class="error-icon">&#x26A0;&#xFE0F;</div>
    <h3>Error</h3>
    <p id="error-message"></p>
    <button id="retry-btn" class="btn btn-primary">Retry</button>
  </div>

  <div id="content" style="display: none;">
    <!-- Header: status + title + branch info + actions -->
    <header class="pr-header">
      <div class="header-top">
        <div class="header-left">
          <span id="pr-status-badge" class="status-badge"></span>
          <h1 id="pr-title" class="pr-title" tabindex="0"></h1>
          <span id="pr-number" class="pr-number"></span>
        </div>
        <div class="header-right">
          <button id="refresh-btn" class="icon-btn" title="Refresh">&#x21bb;</button>
          <button id="open-web-btn" class="icon-btn" title="Open in browser">&#x1F517;</button>
        </div>
      </div>

      <div class="header-meta">
        <span class="pr-author">
          <a class="user-link" id="author-avatar-link" href="#" style="display:none"><img id="author-avatar" src="" alt="" class="avatar avatar-sm"></a>
          <a class="user-link" id="author-name" href="#"></a>
        </span>
        <span id="pr-created" class="pr-date"></span>
        <span id="pr-mergeable-badge" class="mergeable-badge" style="display: none;"></span>
        <span class="pr-branch">
          <span id="base-branch" class="branch-chip"></span>
          <span class="branch-arrow">&larr;</span>
          <span id="head-branch" class="branch-chip"></span>
          <span id="cross-repo-badge" class="cross-repo-badge" style="display: none;">from fork</span>
        </span>
      </div>
    </header>

    <!-- Action bar: primary PR actions -->
    <nav class="action-bar">
      <button id="checkout-btn" class="btn btn-primary">Checkout</button>
      <div id="merge-actions" class="action-group" style="display: none;">
        <button id="merge-btn" class="btn btn-success">Merge</button>
      </div>
      <button id="reopen-pr-btn" class="btn btn-secondary" style="display: none;">Reopen</button>
      <button id="toggle-draft-btn" class="btn btn-secondary" style="display: none;">Ready for Review</button>
      <div id="revert-actions" class="action-group" style="display: none;">
        <button id="revert-btn" class="btn btn-danger">Revert</button>
      </div>
    </nav>

    <!-- Meta: labels, assignees, reviewers as manageable sections -->
    <div class="meta-grid">
      <div id="labels-container" class="meta-section" style="display: none;">
        <div class="meta-header">
          <span class="meta-title">Labels</span>
          <button id="add-label-btn" class="meta-manage-btn" title="Manage labels">+ Add</button>
        </div>
        <div id="labels-list" class="labels-list"></div>
      </div>
      <div id="assignees-container" class="meta-section" style="display: none;">
        <div class="meta-header">
          <span class="meta-title">Assignees</span>
          <button id="add-assignee-btn" class="meta-manage-btn" title="Manage assignees">+ Add</button>
        </div>
        <div id="assignees-list" class="assignees-list"></div>
      </div>
      <div id="reviewers-container" class="meta-section" style="display: none;">
        <div class="meta-header">
          <span class="meta-title">Reviewers</span>
          <button id="add-reviewer-btn" class="meta-manage-btn" title="Manage reviewers">+ Add</button>
        </div>
        <div id="reviewers-list" class="reviewers-list"></div>
      </div>
      <div id="milestone-container" class="meta-section">
        <div class="meta-header">
          <span class="meta-title">Milestone</span>
          <button id="manage-milestone-btn" class="meta-manage-btn" title="Set milestone">Set</button>
        </div>
        <div id="milestone-name" class="milestone-name"><span class="meta-empty">No milestone</span></div>
      </div>
    </div>

    <!-- Description -->
    <section class="content-section">
      <div class="section-header">
        <h2>Description</h2>
        <button id="edit-description-btn" class="btn btn-secondary btn-sm">Edit</button>
      </div>
      <div id="pr-description" class="markdown-body"></div>
      <div id="pr-reactions-bar" class="reactions-bar" style="display: none;"></div>
      <div id="pr-description-editor" class="description-editor" style="display: none;">
        <textarea id="description-textarea" class="description-textarea"></textarea>
        <div class="editor-actions">
          <button id="save-description-btn" class="btn btn-primary btn-sm">Save</button>
          <button id="cancel-description-btn" class="btn btn-secondary btn-sm">Cancel</button>
        </div>
      </div>
    </section>

    <!-- CI/Checks -->
    <section id="ci-section" class="content-section" style="display: none;">
      <div class="section-header">
        <h2>Checks</h2>
        <span id="ci-summary" class="ci-summary"></span>
      </div>
      <div id="ci-status-list" class="ci-list"></div>
    </section>

    <!-- Activity timeline -->
    <section class="content-section">
      <div class="section-header">
        <h2>Activity</h2>
        <span id="activity-count" class="section-count"></span>
      </div>
      <div id="activity-timeline" class="timeline">
        <div class="timeline-line"></div>
      </div>
    </section>

    <!-- Comment composer (sticky bottom) -->
    <div id="comment-input-container" class="comment-composer" style="display: none;">
      <textarea id="comment-input" placeholder="Write a comment..." class="comment-textarea"></textarea>
      <div class="composer-actions">
        <button id="submit-comment-btn" class="btn btn-primary btn-sm">Comment</button>
        <button id="submit-review-btn" class="btn btn-secondary btn-sm">Review</button>
      </div>
    </div>

    <!-- Review dialog -->
    <div id="review-dialog" class="modal-overlay" style="display: none;">
      <div class="modal">
        <h3>Submit Review</h3>
        <select id="review-state" class="modal-select">
          <option value="COMMENT">Comment</option>
          <option value="APPROVE">Approve</option>
          <option value="REQUEST_CHANGES">Request Changes</option>
        </select>
        <textarea id="review-body" class="modal-textarea" placeholder="Review comment..."></textarea>
        <div class="modal-actions">
          <button id="confirm-review-btn" class="btn btn-primary">Submit Review</button>
          <button id="cancel-review-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Merge dialog -->
    <div id="merge-dialog" class="modal-overlay" style="display: none;">
      <div class="modal">
        <h3>Merge Pull Request</h3>
        <select id="merge-strategy" class="modal-select">
          <option value="merge">Create a merge commit</option>
          <option value="squash">Squash and merge</option>
          <option value="rebase">Rebase and merge</option>
          <option value="rebase-merge">Rebase then merge commit</option>
          <option value="fast-forward-only">Fast-forward only</option>
        </select>
        <input id="merge-title" class="modal-input" placeholder="Merge title (optional)">
        <textarea id="merge-message" class="modal-textarea" placeholder="Merge message (optional)"></textarea>
        <label class="modal-checkbox">
          <input type="checkbox" id="merge-delete-branch"> Delete branch after merge
        </label>
        <div class="modal-actions">
          <button id="confirm-merge-btn" class="btn btn-success">Merge</button>
          <button id="cancel-merge-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Emoji picker -->
    <div id="emoji-picker" class="emoji-picker" style="display: none;">
      <span class="emoji-option" data-emoji="+1">\u{1F44D}</span>
      <span class="emoji-option" data-emoji="-1">\u{1F44E}</span>
      <span class="emoji-option" data-emoji="laugh">\u{1F604}</span>
      <span class="emoji-option" data-emoji="hooray">\u{1F389}</span>
      <span class="emoji-option" data-emoji="confused">\u{1F615}</span>
      <span class="emoji-option" data-emoji="heart">\u2764\uFE0F</span>
      <span class="emoji-option" data-emoji="rocket">\u{1F680}</span>
      <span class="emoji-option" data-emoji="eyes">\u{1F440}</span>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
