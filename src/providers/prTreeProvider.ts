import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { PullRequestListItem } from '../models/pullRequest';
import { getForgejoConfig } from '../utils/config';

export class PRTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItem,
    public readonly htmlUrl: string
  ) {
    super(`#${pr.number}: ${pr.title}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${pr.title}\nby ${pr.user.login}\nState: ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}`;
    this.description = `by ${pr.user.login}`;
    this.contextValue = 'pullRequest';

    // Set icon based on state
    if (pr.merged) {
      this.iconPath = new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    } else if (pr.draft) {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-draft');
    } else if (pr.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    // Make clickable - opens in browser
    this.command = {
      command: 'forgejo.openPrInBrowser',
      title: 'Open PR in Browser',
      arguments: [htmlUrl]
    };
  }
}

class PRGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly pullRequests: PullRequestListItem[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${pullRequests.length}`;
    this.contextValue = 'prGroup';
  }
}

export class PRTreeProvider implements vscode.TreeDataProvider<PRTreeItem | PRGroupItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<PRTreeItem | PRGroupItem | undefined | null | void> = new vscode.EventEmitter<PRTreeItem | PRGroupItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PRTreeItem | PRGroupItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private pullRequests: PullRequestListItem[] = [];
  private error: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PRTreeItem | PRGroupItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PRTreeItem | PRGroupItem): Promise<(PRTreeItem | PRGroupItem)[]> {
    if (!element) {
      // Root level - fetch PRs and group them
      try {
        await this.fetchPullRequests();

        if (this.error) {
          return [];
        }

        if (this.pullRequests.length === 0) {
          return [];
        }

        // Group by state
        const openPRs = this.pullRequests.filter(pr => pr.state === 'open' && !pr.draft);
        const draftPRs = this.pullRequests.filter(pr => pr.draft);
        const closedPRs = this.pullRequests.filter(pr => pr.state === 'closed' && !pr.merged);
        const mergedPRs = this.pullRequests.filter(pr => pr.merged);

        const groups: PRGroupItem[] = [];

        if (openPRs.length > 0) {
          groups.push(new PRGroupItem('Open', openPRs));
        }
        if (draftPRs.length > 0) {
          groups.push(new PRGroupItem('Draft', draftPRs));
        }
        if (mergedPRs.length > 0) {
          groups.push(new PRGroupItem('Merged', mergedPRs));
        }
        if (closedPRs.length > 0) {
          groups.push(new PRGroupItem('Closed', closedPRs));
        }

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [];
      }
    } else if (element instanceof PRGroupItem) {
      // Show PRs in this group
      return element.pullRequests.map(pr => new PRTreeItem(pr, pr.html_url));
    }

    return [];
  }

  private async fetchPullRequests(): Promise<void> {
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.pullRequests = [];
      return;
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.pullRequests = await client.getPullRequests(config.owner, config.repo, 'all');
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch pull requests';
      this.pullRequests = [];
      throw error;
    }
  }
}
