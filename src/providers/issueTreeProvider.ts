import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { IssueListItem } from '../models/issue';
import { getForgejoConfig } from '../utils/config';

export class IssueTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issue: IssueListItem,
    public readonly htmlUrl: string
  ) {
    super(`#${issue.number}: ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${issue.title}\nby ${issue.user.login}\nState: ${issue.state}\nComments: ${issue.comments}`;
    this.description = `by ${issue.user.login}`;
    this.contextValue = 'issue';

    // Set icon based on state
    if (issue.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('issue-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('issues', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    }

    // Make clickable - opens in browser
    this.command = {
      command: 'forgejo.openIssueInBrowser',
      title: 'Open Issue in Browser',
      arguments: [htmlUrl]
    };
  }
}

class IssueGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly issues: IssueListItem[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${issues.length}`;
    this.contextValue = 'issueGroup';
  }
}

class IssueMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError: boolean = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type IssueTreeElement = IssueTreeItem | IssueGroupItem | IssueMessageItem;

export class IssueTreeProvider implements vscode.TreeDataProvider<IssueTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeElement | undefined | null | void> = new vscode.EventEmitter<IssueTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<IssueTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private issues: IssueListItem[] = [];
  private error: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IssueTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: IssueTreeElement): Promise<IssueTreeElement[]> {
    if (!element) {
      // Root level - fetch issues and group them
      try {
        await this.fetchIssues();

        if (this.error) {
          console.error('Forgejo Issue fetch error:', this.error);
          return [new IssueMessageItem(this.error, true)];
        }

        if (this.issues.length === 0) {
          return [new IssueMessageItem('No issues found', false)];
        }

        // Group by state
        const openIssues = this.issues.filter(issue => issue.state === 'open');
        const closedIssues = this.issues.filter(issue => issue.state === 'closed');

        const groups: IssueGroupItem[] = [];

        if (openIssues.length > 0) {
          groups.push(new IssueGroupItem('Open', openIssues));
        }
        if (closedIssues.length > 0) {
          groups.push(new IssueGroupItem('Closed', closedIssues));
        }

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new IssueMessageItem(this.error, true)];
      }
    } else if (element instanceof IssueGroupItem) {
      // Show issues in this group
      return element.issues.map(issue => new IssueTreeItem(issue, issue.html_url));
    } else if (element instanceof IssueMessageItem) {
      // Message items have no children
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
