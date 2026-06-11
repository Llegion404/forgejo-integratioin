import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { PullRequest, CommitStatus } from '../../models/pullRequest';
import { Reaction } from '../../models/comment';
import { executeCommand } from '../../commands/registry';
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
  | { type: 'viewFile'; filename: string }
  | { type: 'updateBody'; body: string }
  | { type: 'openCIStatus'; url: string }
  | { type: 'addReaction'; commentId: number; reaction: string }
  | { type: 'removeReaction'; commentId: number; reaction: string }
  | { type: 'openUserProfile'; username: string }
  | { type: 'openInBrowserFromUrl'; url: string }
  | { type: 'editComment'; commentId: number; body: string }
  | { type: 'replyToComment'; body: string; replyToUser: string; originalBody: string }
  | { type: 'reopenPR' }
  | { type: 'toggleDraft' }
  | { type: 'updateTitle'; title: string }
  | { type: 'deleteComment'; commentId: number }
  | { type: 'addLabels'; labels: string[] }
  | { type: 'removeLabel'; label: string }
  | { type: 'addAssignees'; assignees: string[] }
  | { type: 'removeAssignees'; assignees: string[] }
  | { type: 'requestReview'; reviewer: string }
  | { type: 'removeReview'; reviewer: string };

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
      pendingData: null
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

    const { panel, owner, repo, number } = state;
    logInfo('_fetchPRData starting:', { panelKey, isReady: state.isReady });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching PR details from API...');
      const prDetails = await client.getPullRequestDetails(owner, repo, number);
      logInfo('PR details fetched:', { title: prDetails.title });

      const [activities, allStatuses] = await Promise.all([
        this._fetchActivities(client, owner, repo, number),
        prDetails.head.sha ? client.getCommitStatuses(owner, repo, prDetails.head.sha) : Promise.resolve([])
      ]);

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

      state.pendingData = { pr: prDetails, activities, statuses, owner, repo };
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
      case 'merge': await this._mergePR(owner, repo, number, message.strategy, message.message, panelKey); break;
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
      case 'openUserProfile':
        await this._openUserProfile(message.username);
        break;
      case 'openInBrowserFromUrl':
        this._openUrl(message.url);
        break;
      case 'editComment':
        await this._handleEditComment(owner, repo, message.commentId, message.body, panelKey);
        break;
      case 'replyToComment':
        break;
      case 'reopenPR': await this._reopenPR(owner, repo, number, panelKey); break;
      case 'toggleDraft': await this._toggleDraft(owner, repo, number, panelKey); break;
      case 'updateTitle': await this._updateTitle(owner, repo, number, message.title, panelKey); break;
      case 'deleteComment': await this._deleteComment(owner, repo, message.commentId, panelKey); break;
      case 'addLabels': await this._addPRLabels(owner, repo, number, message.labels, panelKey); break;
      case 'removeLabel': await this._removePRLabel(owner, repo, number, message.label, panelKey); break;
      case 'addAssignees': await this._addPRAssignees(owner, repo, number, message.assignees, panelKey); break;
      case 'removeAssignees': await this._removePRAssignees(owner, repo, number, message.assignees, panelKey); break;
      case 'requestReview': await this._requestPRReview(owner, repo, number, message.reviewer, panelKey); break;
      case 'removeReview': await this._removePRReview(owner, repo, number, message.reviewer, panelKey); break;
      case 'viewCommit': break;
      case 'viewFile': break;
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

  private async _mergePR(owner: string, repo: string, number: number, strategy: string, message?: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.mergePullRequest(owner, repo, number, strategy as 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only', false);
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

  private async _addPRLabels(owner: string, repo: string, number: number, labels: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.addPRLabels(owner, repo, number, labels);
      void vscode.window.showInformationMessage(`Added label: ${labels.join(', ')}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add label: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removePRLabel(owner: string, repo: string, number: number, label: string, panelKey?: string): Promise<void> {
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

  private async _addPRAssignees(owner: string, repo: string, number: number, assignees: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.addPRAssignees(owner, repo, number, assignees);
      void vscode.window.showInformationMessage(`Added assignee: ${assignees.join(', ')}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removePRAssignees(owner: string, repo: string, number: number, assignees: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removePRAssignees(owner, repo, number, assignees);
      void vscode.window.showInformationMessage(`Removed assignee: ${assignees.join(', ')}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _requestPRReview(owner: string, repo: string, number: number, reviewer: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.requestPRReview(owner, repo, number, reviewer);
      void vscode.window.showInformationMessage(`Requested review from ${reviewer}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to request review: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removePRReview(owner: string, repo: string, number: number, reviewer: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removePRReview(owner, repo, number, reviewer);
      void vscode.window.showInformationMessage(`Removed reviewer ${reviewer}`);
      if (panelKey) await this._fetchPRData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove reviewer: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https:;">
  <title>PR Details</title>
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
    <header class="pr-header">
      <div class="pr-title-row">
        <h1 id="pr-title"></h1>
        <span id="pr-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>

      <div class="pr-meta">
        <span id="pr-status-badge" class="status-badge"></span>
        <span id="pr-mergeable-badge" class="mergeable-badge" style="display: none;"></span>
        <span class="pr-author">
          by <a class="user-link" id="author-avatar-link" href="#" style="display:none"><img id="author-avatar" src="" alt="" class="avatar"></a>
          <a class="user-link" id="author-name" href="#"></a>
        </span>
        <span id="pr-created" class="pr-date"></span>
        <span id="pr-comment-count" class="pr-comment-count" style="display: none;"></span>
        <span class="pr-branch">
          <span id="base-branch"></span>
          <span class="branch-arrow">←</span>
          <span id="head-branch"></span>
          <span id="cross-repo-badge" class="cross-repo-badge" style="display: none;">from fork</span>
        </span>
      </div>

      <div id="labels-container" class="labels-container" style="display: none;">
        <button id="add-label-btn" class="icon-btn-small" title="Add label">+</button>
      </div>
      <div id="assignees-container" class="assignees-container" style="display: none;">
        <button id="add-assignee-btn" class="icon-btn-small" title="Add assignee">+</button>
      </div>
      <div id="reviewers-container" class="reviewers-container" style="display: none;">
        <button id="add-reviewer-btn" class="icon-btn-small" title="Request review">+</button>
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
      <button id="reopen-pr-btn" class="btn btn-success" style="display: none;">Reopen</button>
      <button id="toggle-draft-btn" class="btn btn-secondary" style="display: none;">Ready for Review</button>
    </nav>

    <section class="description-section">
      <div class="description-header">
        <h2>Description</h2>
        <button id="edit-description-btn" class="btn btn-secondary btn-small">Edit</button>
      </div>
      <div id="pr-description" class="markdown-body"></div>
      <div id="pr-description-editor" class="description-editor" style="display: none;">
        <textarea id="description-textarea" class="description-textarea"></textarea>
        <div class="description-editor-actions">
          <button id="save-description-btn" class="btn btn-primary btn-small">Save</button>
          <button id="cancel-description-btn" class="btn btn-secondary btn-small">Cancel</button>
        </div>
      </div>
    </section>

    <section id="ci-section" class="ci-section" style="display: none;">
      <h2>CI Status</h2>
      <div id="ci-status-list"></div>
    </section>

    <section class="activity-section">
      <h2>Activity <span id="activity-count"></span></h2>
      <div id="activity-timeline">
        <div class="activity-timeline-line"></div>
      </div>
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

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
