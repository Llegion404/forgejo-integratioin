import * as vscode from 'vscode';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { Issue } from '../../models/issue';
import { Reaction } from '../../models/comment';
import { logDebug, logInfo, logError } from '../../utils/logger';
import { BaseDetailWebviewProvider } from '../shared/baseWebviewProvider';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'addComment'; body: string }
  | { type: 'openInBrowser' }
  | { type: 'closeIssue' }
  | { type: 'reopenIssue' }
  | { type: 'updateBody'; body: string }
  | { type: 'addReaction'; commentId: number; reaction: string }
  | { type: 'removeReaction'; commentId: number; reaction: string }
  | { type: 'openUserProfile'; username: string }
  | { type: 'openInBrowserFromUrl'; url: string }
  | { type: 'editComment'; commentId: number; body: string }
  | { type: 'replyToComment'; body: string; replyToUser: string; originalBody: string }
  | { type: 'updateTitle'; title: string }
  | { type: 'deleteComment'; commentId: number }
  | { type: 'addIssueReaction'; reaction: string }
  | { type: 'removeIssueReaction'; reaction: string }
  | { type: 'addLabels'; labels: string[] }
  | { type: 'removeLabel'; label: string }
  | { type: 'addAssignees'; assignees: string[] }
  | { type: 'removeAssignees'; assignees: string[] }
  | { type: 'lockIssue'; reason?: string }
  | { type: 'unlockIssue' }
  | { type: 'showConfirm'; id: number; message: string }
  | { type: 'showInputBox'; id: number; prompt: string; defaultValue?: string };

export interface IssueActivity {
  type: 'comment' | 'timeline';
  id: number;
  created_at?: string;
  user?: {
    login: string;
    avatar_url?: string;
  };
  body?: string;
  event?: string;
  html_url?: string;
  reactions?: Reaction[];
}

export interface IssueDetailViewData {
  issue: Issue;
  activities: IssueActivity[];
  issueReactions: Reaction[];
  owner: string;
  repo: string;
}

interface PanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  number: number;
  isReady: boolean;
  pendingData?: IssueDetailViewData | null;
  lastRequestId: number;
}

export class IssueDetailWebviewProvider extends BaseDetailWebviewProvider<PanelState> {
  public static readonly viewType = 'forgejo.issueDetail';
  public readonly viewType = 'forgejo.issueDetail';

  constructor(extensionUri: vscode.Uri) { super(extensionUri); }

  public async showIssueDetails(owner: string, repo: string, number: number): Promise<void> {
    logInfo('Showing Issue details in webview:', { owner, repo, number });

    const panelKey = `${owner}/${repo}/issue/${String(number)}`;

    if (this._panels.has(panelKey)) {
      const state = this._panels.get(panelKey);
      if (state) {
        state.panel.reveal(vscode.ViewColumn.One);
        await this._loadIssueData(panelKey);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      IssueDetailWebviewProvider.viewType,
      `Issue #${String(number)}: ${owner}/${repo}`,
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

    void this._fetchIssueData(panelKey);
  }

  private async _fetchIssueData(panelKey: string): Promise<void> {
    const state = this._panels.get(panelKey);
    if (!state) return;

    const requestId = ++state.lastRequestId;
    const { panel, owner, repo, number } = state;
    logInfo('_fetchIssueData starting:', { panelKey, isReady: state.isReady, requestId });

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('Forgejo configuration not found');

      const client = new ForgejoClient(config.instanceUrl, config.token);
      logInfo('Fetching Issue details from API...');
      const issueDetails = await client.getIssueDetails(owner, repo, number);
      if (requestId !== state.lastRequestId) {
        logInfo('Issue fetch superseded by newer request, ignoring', { requestId });
        return;
      }
      logInfo('Issue details fetched:', { title: issueDetails.title });

      const activities = await this._fetchActivities(client, owner, repo, number);
      if (requestId !== state.lastRequestId) {
        logInfo('Issue fetch (activities) superseded, ignoring', { requestId });
        return;
      }
      logInfo('Activities fetched:', { activities: activities.length });

      let issueReactions: Reaction[] = [];
      try {
        issueReactions = await client.getIssueReactions(owner, repo, issueDetails.id);
      } catch (e) { logDebug('Could not fetch issue reactions:', e); }
      if (requestId !== state.lastRequestId) {
        logInfo('Issue fetch (reactions) superseded, ignoring', { requestId });
        return;
      }

      state.pendingData = { issue: issueDetails, activities, issueReactions, owner, repo };
      logInfo('pendingData set, isReady:', state.isReady);

      if (state.isReady) {
        logInfo('Webview is ready, sending data...');
        this._sendDataToPanel(panelKey);
      } else {
        logInfo('Webview not ready yet, data will be sent when ready');
      }
    } catch (error) {
      logError('Failed to fetch Issue data:', error);
      if (state.isReady) {
        void panel.webview.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load Issue details'
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
    logInfo('Posting messages to webview:', { issueTitle: state.pendingData.issue.title });
    void panel.webview.postMessage({ type: 'theme', theme: this._getThemeName(vscode.window.activeColorTheme.kind) });
    void panel.webview.postMessage({ type: 'loading', show: true });
    void panel.webview.postMessage({ type: 'update', data: state.pendingData });
    void panel.webview.postMessage({ type: 'loading', show: false });
    logInfo('All messages posted to webview');
  }

  private async _loadIssueData(panelKey: string): Promise<void> {
    await this._fetchIssueData(panelKey);
  }

  private async _fetchActivities(client: ForgejoClient, owner: string, repo: string, number: number): Promise<IssueActivity[]> {
    const activities: IssueActivity[] = [];
    let comments: IssueActivity[] = [];
    try {
      const rawComments = await client.getIssueComments(owner, repo, number);
      comments = (rawComments as IssueActivity[]).map((c) => ({ ...c, type: 'comment' as const }));
      await Promise.all(comments.map(async (c) => {
        try {
          const reactions = await client.getCommentReactions(owner, repo, c.id);
          c.reactions = reactions;
        } catch (e) { logDebug('Could not fetch reactions for comment:', c.id, e); }
      }));
      activities.push(...comments);
    } catch (e) { logDebug('Could not fetch comments:', e); }
    try {
      const timeline = await client.getIssueTimeline(owner, repo, number);
      // Filter out comment events to avoid duplicating entries already fetched via getIssueComments.
      // Forgejo API returns event type as `type`; map it to `event` for the webview before overwriting `type`.
      activities.push(...(timeline as any[]).filter((t) => (t.type || t.event) !== 'comment').map((t) => ({ ...t, event: t.type || t.event, type: 'timeline' as const })));
    } catch (e) { logDebug('Could not fetch timeline:', e); }
    return activities.sort((a, b) => {
      const dateA = new Date(a.created_at ?? 0);
      const dateB = new Date(b.created_at ?? 0);
      return dateA.getTime() - dateB.getTime();
    });
  }

  private async _handleMessage(message: WebviewMessage, panelKey: string): Promise<void> {
    logDebug('Received message from webview:', message.type);
    const state = this._panels.get(panelKey);
    if (!state) return;

    const { owner, repo, number } = state;

    switch (message.type) {
      case 'ready':
        logInfo('Webview ready message received, pendingData exists:', !!state.pendingData);
        state.isReady = true;
        if (state.pendingData) {
          logInfo('Sending pending data to webview...');
          this._sendDataToPanel(panelKey);
        } else {
          logInfo('No pending data yet, showing loading state');
          void state.panel.webview.postMessage({ type: 'loading', show: true });
        }
        break;
      case 'refresh': await this._fetchIssueData(panelKey); break;
      case 'addComment': await this._addComment(owner, repo, number, message.body, panelKey); break;
      case 'openInBrowser': await this._openInBrowser(owner, repo, number); break;
      case 'closeIssue': await this._closeIssue(owner, repo, number, panelKey); break;
      case 'reopenIssue': await this._reopenIssue(owner, repo, number, panelKey); break;
      case 'updateBody': await this._updateBody(owner, repo, number, message.body, panelKey); break;
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
        await this._replyToComment(owner, repo, number, message.body, panelKey);
        break;
      case 'updateTitle': await this._updateTitle(owner, repo, number, message.title, panelKey); break;
      case 'deleteComment': await this._deleteComment(owner, repo, message.commentId, panelKey); break;
      case 'addIssueReaction':
        await this._handleIssueReaction(owner, repo, state.number, message.reaction, 'add', panelKey);
        break;
      case 'removeIssueReaction':
        await this._handleIssueReaction(owner, repo, state.number, message.reaction, 'remove', panelKey);
        break;
      case 'addLabels':
        await this._addLabels(owner, repo, number, message.labels, panelKey);
        break;
      case 'removeLabel':
        await this._removeLabel(owner, repo, number, message.label, panelKey);
        break;
      case 'addAssignees':
        await this._addAssignees(owner, repo, number, message.assignees, panelKey);
        break;
      case 'removeAssignees':
        await this._removeAssignees(owner, repo, number, message.assignees, panelKey);
        break;
      case 'lockIssue':
        await this._lockIssue(owner, repo, number, message.reason, panelKey);
        break;
      case 'unlockIssue':
        await this._unlockIssue(owner, repo, number, panelKey);
        break;
      case 'showConfirm': await this._handleShowConfirm(state.panel.webview, message.id, message.message); break;
      case 'showInputBox': await this._handleShowInputBox(state.panel.webview, message.id, message.prompt, message.defaultValue); break;
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
      if (panelKey) await this._fetchIssueData(panelKey);
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
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to update comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'editComment', success: false });
      }
    }
  }

  private async _replyToComment(owner: string, repo: string, number: number, body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.createComment(owner, repo, number, body);
      void vscode.window.showInformationMessage('Reply posted');
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'replyToComment', success: true });
      }
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to post reply: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'replyToComment', success: false });
      }
    }
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
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'addComment', success: false });
      }
    }
  }

  private async _closeIssue(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateIssueState(owner, repo, number, 'closed');
      void vscode.window.showInformationMessage(`Issue #${String(number)} closed`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to close issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _reopenIssue(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateIssueState(owner, repo, number, 'open');
      void vscode.window.showInformationMessage(`Issue #${String(number)} reopened`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to reopen issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _updateBody(owner: string, repo: string, number: number, body: string, panelKey?: string): Promise<void> {
    const panelState = panelKey ? this._panels.get(panelKey) : undefined;
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const updatedIssue = await client.updateIssueBody(owner, repo, number, body);
      logInfo('Issue body updated:', { owner, repo, number });
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'bodyUpdated', body: updatedIssue.body });
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: true });
      }
      if (panelState?.pendingData) {
        panelState.pendingData.issue.body = updatedIssue.body;
      }
    } catch (error) {
      logError('Failed to update issue body:', error);
      void vscode.window.showErrorMessage(`Failed to update description: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (panelState) {
        void panelState.panel.webview.postMessage({ type: 'actionComplete', action: 'updateBody', success: false });
      }
    }
  }

  private async _updateTitle(owner: string, repo: string, number: number, title: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.updateIssue(owner, repo, number, { title });
      void vscode.window.showInformationMessage('Title updated');
      if (panelKey) await this._fetchIssueData(panelKey);
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
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to delete comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _handleIssueReaction(owner: string, repo: string, number: number, reaction: string, action: 'add' | 'remove', panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      if (action === 'add') {
        await client.addIssueReaction(owner, repo, number, reaction);
      } else {
        await client.deleteIssueReaction(owner, repo, number, reaction);
      }
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to ${action} reaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _addLabels(owner: string, repo: string, number: number, labels: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.addIssueLabel(owner, repo, number, labels);
      void vscode.window.showInformationMessage(`Added label: ${labels.join(', ')}`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add label: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removeLabel(owner: string, repo: string, number: number, label: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removeIssueLabel(owner, repo, number, label);
      void vscode.window.showInformationMessage(`Removed label: ${label}`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove label: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _addAssignees(owner: string, repo: string, number: number, assignees: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.addIssueAssignees(owner, repo, number, assignees);
      void vscode.window.showInformationMessage(`Added assignee: ${assignees.join(', ')}`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to add assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _removeAssignees(owner: string, repo: string, number: number, assignees: string[], panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.removeIssueAssignees(owner, repo, number, assignees);
      void vscode.window.showInformationMessage(`Removed assignee: ${assignees.join(', ')}`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to remove assignee: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _lockIssue(owner: string, repo: string, number: number, reason?: string, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.lockIssue(owner, repo, number, reason);
      void vscode.window.showInformationMessage(`Issue #${String(number)} locked`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to lock issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _unlockIssue(owner: string, repo: string, number: number, panelKey?: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.unlockIssue(owner, repo, number);
      void vscode.window.showInformationMessage(`Issue #${String(number)} unlocked`);
      if (panelKey) await this._fetchIssueData(panelKey);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to unlock issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async _openInBrowser(owner: string, repo: string, number: number): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');
      const url = `${config.instanceUrl}/${owner}/${repo}/issues/${String(number)}`;
      void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueDetail', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'issueDetail', 'index.js'));

    const nonce = this._getNonce();
    const csp = this._buildCsp(nonce, webview);
    const sharedAssets = this._sharedAssetsHtml(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Issue Details</title>
  ${sharedAssets}
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="loading" class="loading">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-subtitle"></div>
    <div class="skeleton skeleton-line"></div>
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
    <header class="issue-header">
      <div class="issue-title-row">
        <h1 id="issue-title"></h1>
        <span id="issue-number"></span>
        <button id="copy-url-btn" class="icon-btn" title="Copy URL">📋</button>
      </div>

      <div class="issue-meta">
        <span id="issue-status-badge" class="status-badge"></span>
        <span class="issue-author">
          by <a class="user-link" id="author-avatar-link" href="#" style="display:none"><img id="author-avatar" src="" alt="" class="avatar"></a>
          <a class="user-link" id="author-name" href="#"></a>
        </span>
        <span id="issue-created" class="issue-date"></span>
      </div>

      <div id="labels-container" class="labels-container" style="display: none;">
        <button id="add-label-btn" class="icon-btn-small" title="Add label">+</button>
      </div>
      <div id="assignees-container" class="assignees-container" style="display: none;">
        <button id="add-assignee-btn" class="icon-btn-small" title="Add assignee">+</button>
      </div>
    </header>

    <nav class="action-bar">
      <button id="refresh-btn" class="btn btn-secondary">Refresh</button>
      <button id="open-web-btn" class="btn btn-secondary">Open in Web</button>
      <button id="add-comment-btn" class="btn btn-secondary">+ Comment</button>
      <button id="lock-issue-btn" class="btn btn-secondary" style="display: none;">Lock</button>
      <button id="unlock-issue-btn" class="btn btn-secondary" style="display: none;">Unlock</button>
      <div id="state-actions" class="state-actions">
        <button id="close-issue-btn" class="btn btn-danger" style="display: none;">Close Issue</button>
        <button id="reopen-issue-btn" class="btn btn-success" style="display: none;">Reopen Issue</button>
      </div>
    </nav>

    <section class="description-section">
      <div class="description-header">
        <h2>Description</h2>
        <button id="edit-description-btn" class="btn btn-secondary btn-small">Edit</button>
      </div>
      <div id="issue-description" class="markdown-body"></div>
      <div id="issue-reactions-bar" class="reactions-bar" style="display: none;"></div>
      <div id="issue-description-editor" class="description-editor" style="display: none;">
        <textarea id="description-textarea" class="description-textarea"></textarea>
        <div class="description-editor-actions">
          <button id="save-description-btn" class="btn btn-primary btn-small">Save</button>
          <button id="cancel-description-btn" class="btn btn-secondary btn-small">Cancel</button>
        </div>
      </div>
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
