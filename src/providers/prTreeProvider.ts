import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { PullRequestListItem, PullRequestFile } from '../models/pullRequest';
import { getForgejoConfig } from '../utils/config';
import { createScmBadge } from '../utils/scmBadges';
import { getCached, setCache } from '../utils/cacheStore';

const CACHE_KEY = 'pr-list';

export class PRTreeItem extends vscode.TreeItem {
  public files?: PullRequestFile[];
  public filesError?: string;
  public baseRef?: string;
  public headRef?: string;

  constructor(
    public readonly pr: PullRequestListItem,
    public readonly htmlUrl: string,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(`#${pr.number}: ${pr.title}`, vscode.TreeItemCollapsibleState.Collapsed);

    var descriptionParts = [`by ${pr.user.login}`];
    if (pr.comments > 0) {
      descriptionParts.push(`${pr.comments} comment${pr.comments !== 1 ? 's' : ''}`);
    }
    this.description = descriptionParts.join(' \u2022 ');
    this.tooltip = `${pr.title}\nby ${pr.user.login}\nState: ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}${pr.comments > 0 ? '\nComments: ' + String(pr.comments) : ''}`;
    this.contextValue = 'pullRequest';

    if (pr.merged) {
      this.iconPath = new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    } else if (pr.draft) {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-draft');
    } else if (pr.state === 'closed') {
      this.iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    this.command = undefined;
  }
}

class PRGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly pullRequests: PullRequestListItem[]
  ) {
    const collapsibleState = label === 'Closed' || label === 'Merged'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${pullRequests.length}`;
    this.contextValue = 'prGroup';
  }
}

class PRMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

export class PRFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: PullRequestFile,
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string,
    public readonly baseRef: string,
    public readonly headRef: string
  ) {
    super(file.filename, vscode.TreeItemCollapsibleState.None);

    this.description = `+${file.additions} -${file.deletions}`;
    this.tooltip = `${file.filename}\nStatus: ${file.status}\n+${file.additions} -${file.deletions}`;
    this.contextValue = 'prFile';

    this.iconPath = createScmBadge(file.status);

    this.command = {
      command: 'forgejo.showPrFileDiff',
      title: 'Show Diff',
      arguments: [this.file, this.pr, this.owner, this.repo, this.baseRef, this.headRef]
    };
  }
}

class PRLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading files...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'loading';
  }
}

export class PROverviewItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super('Overview', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'prOverview';
    this.command = {
      command: 'forgejo.showPrDetails',
      title: 'Show PR Details',
      arguments: [pr, owner, repo]
    };
  }
}

export class PRReviewAllItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequestListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super('Review all changes', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('book');
    this.contextValue = 'prReviewAll';
    this.command = {
      command: 'forgejo.reviewPrChanges',
      title: 'Review All Changes',
      arguments: [pr, owner, repo]
    };
  }

  setFileCount(count: number) {
    this.label = `Review all changes (${count} file${count !== 1 ? 's' : ''})`;
  }
}

class PRSyncingItem extends vscode.TreeItem {
  constructor() {
    super('Syncing...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('sync~spin');
    this.description = 'Fetching latest changes';
    this.contextValue = 'syncing';
  }
}

type PRTreeElement = PRTreeItem | PRGroupItem | PRMessageItem | PRFileItem | PRLoadingItem | PROverviewItem | PRReviewAllItem | PRSyncingItem;

export class PRTreeProvider implements vscode.TreeDataProvider<PRTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<PRTreeElement | undefined | null | void> = new vscode.EventEmitter<PRTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PRTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private pullRequests: PullRequestListItem[] = [];
  private error: string | null = null;
  private isSyncing = false;
  private syncPromise: Promise<void> | null = null;

  constructor() {
    const cached = getCached<PullRequestListItem[]>(CACHE_KEY);
    if (cached && cached.length > 0) {
      this.pullRequests = cached;
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
      await this.fetchPullRequests();
      if (this.pullRequests.length > 0) {
        setCache(CACHE_KEY, this.pullRequests);
      }
    } catch {
      // error already stored in this.error by fetchPullRequests
    }

    this.isSyncing = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PRTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PRTreeElement): Promise<PRTreeElement[]> {
    if (!element) {
      const result: PRTreeElement[] = [];

      if (this.isSyncing && this.pullRequests.length === 0) {
        return [new PRSyncingItem()];
      }

      if (this.error) {
        console.error('Forgejo PR fetch error:', this.error);
        return [new PRMessageItem(this.error, true)];
      }

      if (this.isSyncing) {
        result.push(new PRSyncingItem());
      }

      if (this.pullRequests.length === 0) {
        if (!this.isSyncing) {
          return [new PRMessageItem('No pull requests found', false)];
        }
        return result;
      }

      const openPRs = this.pullRequests.filter(pr => pr.state === 'open' && !pr.draft);
      const draftPRs = this.pullRequests.filter(pr => pr.draft);
      const closedPRs = this.pullRequests.filter(pr => pr.state === 'closed' && !pr.merged);
      const mergedPRs = this.pullRequests.filter(pr => pr.merged);

      if (openPRs.length > 0) {
        result.push(new PRGroupItem('Open', openPRs));
      }
      if (draftPRs.length > 0) {
        result.push(new PRGroupItem('Draft', draftPRs));
      }
      if (mergedPRs.length > 0) {
        result.push(new PRGroupItem('Merged', mergedPRs));
      }
      if (closedPRs.length > 0) {
        result.push(new PRGroupItem('Closed', closedPRs));
      }

      return result;
    } else if (element instanceof PRGroupItem) {
      const config = await getForgejoConfig();
      if (!config) {
        return [];
      }
      return element.pullRequests.map(pr => new PRTreeItem(pr, pr.html_url, config.owner, config.repo));
    } else if (element instanceof PRTreeItem) {
      return this.getPRFiles(element);
    } else if (element instanceof PRMessageItem || element instanceof PRLoadingItem || element instanceof PRReviewAllItem || element instanceof PRSyncingItem) {
      return [];
    }

    return [];
  }

  private async getPRFiles(prItem: PRTreeItem): Promise<PRTreeElement[]> {
    const overviewItem = new PROverviewItem(prItem.pr, prItem.owner, prItem.repo);
    const reviewAllItem = new PRReviewAllItem(prItem.pr, prItem.owner, prItem.repo);

    const makeReviewAll = (fileCount: number): PRReviewAllItem => {
      reviewAllItem.setFileCount(fileCount);
      return reviewAllItem;
    };

    if (prItem.files && prItem.baseRef && prItem.headRef) {
      const baseRef = prItem.baseRef;
      const headRef = prItem.headRef;
      const fileItems = prItem.files.map(file =>
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, baseRef, headRef)
      );
      return [overviewItem, makeReviewAll(prItem.files.length), ...fileItems];
    }

    if (prItem.filesError) {
      return [overviewItem, new PRMessageItem(prItem.filesError, true)];
    }

    try {
      const config = await getForgejoConfig();
      if (!config) {
        return [overviewItem, new PRMessageItem('Configuration not available', true)];
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      console.log(`[Forgejo] Fetching files for PR #${prItem.pr.number}...`);

      const [files, refs] = await Promise.all([
        client.getPullRequestFiles(prItem.owner, prItem.repo, prItem.pr.number),
        client.getPullRequestRefs(prItem.owner, prItem.repo, prItem.pr.number)
      ]);

      prItem.files = files;
      prItem.baseRef = refs.base;
      prItem.headRef = refs.head;

      console.log(`[Forgejo] Fetched ${files.length} files for PR #${prItem.pr.number}`);

      if (files.length === 0) {
        return [overviewItem, new PRMessageItem('No files changed', false)];
      }

      const statusOrder: Record<string, number> = { added: 0, modified: 1, changed: 1, renamed: 2, removed: 3 };
      const getStatusPriority = (status: string): number => statusOrder[status] ?? 99;
      const sortedFiles = files.sort((a, b) => getStatusPriority(a.status) - getStatusPriority(b.status));

      const fileItems = sortedFiles.map(file =>
        new PRFileItem(file, prItem.pr, prItem.owner, prItem.repo, refs.base, refs.head)
      );
      return [overviewItem, makeReviewAll(files.length), ...fileItems];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch files';
      prItem.filesError = errorMsg;
      console.error(`[Forgejo] Error fetching files for PR #${prItem.pr.number}:`, error);
      return [overviewItem, new PRMessageItem(errorMsg, true)];
    }
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
