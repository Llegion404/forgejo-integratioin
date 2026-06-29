import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { IssueListItem } from '../models/issue';
import { getForgejoConfig } from '../utils/config';
import { getCached, setCache } from '../utils/cacheStore';

const CACHE_KEY = 'issue-list';

export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issue: IssueListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    var descriptionParts = [`by ${issue.user.login}`];
    if (issue.comments > 0) {
      descriptionParts.push(`${issue.comments} comment${issue.comments !== 1 ? 's' : ''}`);
    }
    this.description = descriptionParts.join(' \u2022 ');
    this.tooltip = `${issue.title}\nby ${issue.user.login}\nState: ${issue.state}\nComments: ${issue.comments}\n\nClick to view details`;
    this.contextValue = 'issue';

    if (issue.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    }

    this.command = {
      command: 'forgejo.showIssueDetails',
      title: 'Show Issue Details',
      arguments: [issue, owner, repo]
    };
  }
}

class IssueGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly issues: IssueListItem[]
  ) {
    const collapsibleState = label === 'Closed'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${issues.length}`;
    this.contextValue = 'issueGroup';
  }
}

class IssueMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

class IssueSyncingItem extends vscode.TreeItem {
  constructor() {
    super('Syncing...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('sync~spin');
    this.description = 'Fetching latest issues';
    this.contextValue = 'syncing';
  }
}

type IssueTreeElement = IssueTreeItem | IssueGroupItem | IssueMessageItem | IssueSyncingItem;

export class IssueTreeProvider implements vscode.TreeDataProvider<IssueTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeElement | undefined | null | void> = new vscode.EventEmitter<IssueTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<IssueTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private issues: IssueListItem[] = [];
  private error: string | null = null;
  private owner = '';
  private repo = '';
  private isSyncing = false;

  constructor() {
    const cached = getCached<IssueListItem[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      this.issues = cached;
    }
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
    void this.syncInBackground();
  }

  private async syncInBackground(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      await this.fetchIssues();
      if (this.issues.length > 0) {
        setCache(CACHE_KEY, this.issues);
      }
    } catch {
      //
    }

    this.isSyncing = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IssueTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: IssueTreeElement): Promise<IssueTreeElement[]> {
    if (!element) {
      const result: IssueTreeElement[] = [];

      if (this.isSyncing && this.issues.length === 0) {
        return [new IssueSyncingItem()];
      }

      if (this.error) {
        console.error('Forgejo Issue fetch error:', this.error);
        return [new IssueMessageItem(this.error, true)];
      }

      if (this.isSyncing) {
        result.push(new IssueSyncingItem());
      }

      if (this.issues.length === 0) {
        if (!this.isSyncing) {
          return [new IssueMessageItem('No issues found', false)];
        }
        return result;
      }

      const openIssues = this.issues.filter(issue => issue.state === 'open');
      const closedIssues = this.issues.filter(issue => issue.state === 'closed');

      if (openIssues.length > 0) {
        result.push(new IssueGroupItem('Open', openIssues));
      }
      if (closedIssues.length > 0) {
        result.push(new IssueGroupItem('Closed', closedIssues));
      }

      return result;
    } else if (element instanceof IssueGroupItem) {
      return element.issues.map(issue => new IssueTreeItem(issue, issue.html_url, this.owner, this.repo));
    } else if (element instanceof IssueMessageItem || element instanceof IssueSyncingItem) {
      return [];
    }

    return [];
  }

  private async fetchIssues(): Promise<void> {
    console.log('[Forgejo] Fetching issues...');
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.issues = [];
      console.warn('[Forgejo] No config found');
      return;
    }

    console.log('[Forgejo] Using config:', {
      instanceUrl: config.instanceUrl,
      owner: config.owner,
      repo: config.repo,
      hasToken: !!config.token
    });

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.issues = await client.getIssues(config.owner, config.repo, 'all');
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      console.log(`[Forgejo] Fetched ${this.issues.length} issues`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch issues';
      this.issues = [];
      console.error('[Forgejo] Error fetching issues:', error);
      throw error;
    }
  }
}
