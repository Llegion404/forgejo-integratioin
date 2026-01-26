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

class PRMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError: boolean = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type PRTreeElement = PRTreeItem | PRGroupItem | PRMessageItem;

export class PRTreeProvider implements vscode.TreeDataProvider<PRTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<PRTreeElement | undefined | null | void> = new vscode.EventEmitter<PRTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PRTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private pullRequests: PullRequestListItem[] = [];
  private error: string | null = null;

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PRTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PRTreeElement): Promise<PRTreeElement[]> {
    if (!element) {
      // Root level - fetch PRs and group them
      try {
        await this.fetchPullRequests();

        if (this.error) {
          console.error('Forgejo PR fetch error:', this.error);
          return [new PRMessageItem(this.error, true)];
        }

        if (this.pullRequests.length === 0) {
          return [new PRMessageItem('No pull requests found', false)];
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
    } else if (element instanceof PRMessageItem) {
      // Message items have no children
      return [];
    }

    return [];
  }

  private async fetchPullRequests(): Promise<void> {
    console.log('[Forgejo] Fetching pull requests...');
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.pullRequests = [];
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
      this.pullRequests = await client.getPullRequests(config.owner, config.repo, 'all');
      this.error = null;
      console.log(`[Forgejo] Fetched ${this.pullRequests.length} pull requests`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch pull requests';
      this.pullRequests = [];
      console.error('[Forgejo] Error fetching PRs:', error);
      throw error;
    }
  }
}
