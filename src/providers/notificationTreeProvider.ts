import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { logError } from '../utils/logger';

/**
 * Notifications tree (B4.2) — surfaces unread Forgejo threads.
 *
 * Lists unread notifications for the current user. Polls every 60s while the
 * view is visible. Read actions are routed via forgejo.markNotificationRead /
 * forgejo.markAllNotificationsRead commands which the extension forwards to
 * the Forgejo REST API.
 */
interface NotificationThread {
  id: number;
  subject: { title?: string; type?: string; url?: string; latest_comment_url?: string };
  repository?: { full_name?: string };
  reason?: string;
  unread?: boolean;
  pinned?: boolean;
  updated_at?: string;
}

export class NotificationTreeItem extends vscode.TreeItem {
  constructor(public readonly thread: NotificationThread) {
    super(thread.subject?.title || '(no subject)', vscode.TreeItemCollapsibleState.None);
    this.description = thread.repository?.full_name ?? '';
    this.tooltip = `${thread.subject?.title || '(no subject)'}\nRepo: ${thread.repository?.full_name ?? 'unknown'}\nReason: ${thread.reason ?? 'unknown'}\nUpdated: ${thread.updated_at ?? ''}`;
    this.contextValue = 'notification';
    this.iconPath = new vscode.ThemeIcon(thread.subject?.type === 'Issue' ? 'issues'
      : thread.subject?.type === 'PullRequest' ? 'git-pull-request'
      : thread.subject?.type === 'Release' ? 'tag'
      : 'bell');
  }
}

class NotificationMessageItem extends vscode.TreeItem {
  constructor(message: string, isError = false) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

class NotificationSyncingItem extends vscode.TreeItem {
  constructor() {
    super('Syncing...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('sync~spin');
    this.description = 'Fetching latest notifications';
    this.contextValue = 'syncing';
  }
}

type NotificationTreeElement = NotificationTreeItem | NotificationMessageItem | NotificationSyncingItem;

export class NotificationTreeProvider implements vscode.TreeDataProvider<NotificationTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NotificationTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private threads: NotificationThread[] = [];
  private error: string | null = null;
  private isSyncing = false;
  private pollHandle?: NodeJS.Timeout;

  constructor() { this.refresh(); this.pollHandle = setInterval(() => this.refresh(), 60_000); }

  dispose(): void {
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = undefined; }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
    void this.sync();
  }

  private async sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const config = await getForgejoConfig();
      if (!config) {
        this.threads = [];
        this.error = null;
        return;
      }
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.threads = (await (client as any).rawRequest('GET', '/notifications?limit=50&status=unread')) as NotificationThread[];
      this.error = null;
    } catch (err) {
      logError('Failed to fetch notifications:', err);
      this.error = err instanceof Error ? err.message : 'Failed to fetch notifications';
      this.threads = [];
    } finally {
      this.isSyncing = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: NotificationTreeElement): vscode.TreeItem { return element; }

  async getChildren(): Promise<NotificationTreeElement[]> {
    if (this.isSyncing && this.threads.length === 0) return [new NotificationSyncingItem()];
    if (this.error) return [new NotificationMessageItem(this.error, true)];
    if (this.threads.length === 0) return [new NotificationMessageItem('No unread notifications')];
    return this.threads.map(t => new NotificationTreeItem(t));
  }

  public getThread(id: number): NotificationThread | undefined {
    return this.threads.find(t => t.id === id);
  }

  async markRead(threadId: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) return;
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.markNotificationRead(threadId);
      this.threads = this.threads.filter(t => String(t.id) !== threadId);
      this._onDidChangeTreeData.fire();
    } catch (err) {
      logError('Failed to mark notification as read:', err);
    }
  }

  async markAllRead(): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) return;
      const client = new ForgejoClient(config.instanceUrl, config.token);
      await client.markAllNotificationsRead();
      this.threads = [];
      this._onDidChangeTreeData.fire();
    } catch (err) {
      logError('Failed to mark all notifications as read:', err);
    }
  }
}
