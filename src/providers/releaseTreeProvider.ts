import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { type Release } from 'forgejo-ts';

export class ReleaseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly release: Release,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(release.name || release.tag_name, vscode.TreeItemCollapsibleState.None);

    const status = release.draft ? 'Draft' : release.prerelease ? 'Pre-release' : 'Released';
    this.tooltip = `${release.name || release.tag_name}\nTag: ${release.tag_name}\nStatus: ${status}\n\nClick to open in browser`;
    this.description = release.tag_name;
    this.contextValue = release.draft ? 'releaseDraft' : release.prerelease ? 'releasePrerelease' : 'release';

    if (release.draft) {
      this.iconPath = new vscode.ThemeIcon('edit');
    } else if (release.prerelease) {
      this.iconPath = new vscode.ThemeIcon('beaker');
    } else {
      this.iconPath = new vscode.ThemeIcon('tag');
    }

    this.command = {
      command: 'forgejo.showReleaseDetails',
      title: 'Show Release Details',
      arguments: [this]
    };
  }
}

class ReleaseGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly releases: Release[]
  ) {
    const collapsibleState = label === 'Drafts'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
    super(label, collapsibleState);
    this.description = `${releases.length}`;
    this.contextValue = 'releaseGroup';
  }
}

class ReleaseMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type ReleaseTreeElement = ReleaseTreeItem | ReleaseGroupItem | ReleaseMessageItem;

export class ReleaseTreeProvider implements vscode.TreeDataProvider<ReleaseTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReleaseTreeElement | undefined | null | void> = new vscode.EventEmitter<ReleaseTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReleaseTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private releases: Release[] = [];
  private error: string | null = null;
  private owner = '';
  private repo = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getOwner(): string { return this.owner; }
  getRepo(): string { return this.repo; }

  getTreeItem(element: ReleaseTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ReleaseTreeElement): Promise<ReleaseTreeElement[]> {
    if (!element) {
      try {
        await this._fetchReleases();

        if (this.error) {
          console.error('[Forgejo] Release fetch error:', this.error);
          return [new ReleaseMessageItem(this.error, true)];
        }

        if (this.releases.length === 0) {
          return [new ReleaseMessageItem('No releases found', false)];
        }

        const published = this.releases.filter(r => !r.draft && !r.prerelease);
        const prereleases = this.releases.filter(r => !r.draft && r.prerelease);
        const drafts = this.releases.filter(r => r.draft);

        const groups: ReleaseGroupItem[] = [];
        if (published.length > 0) groups.push(new ReleaseGroupItem('Released', published));
        if (prereleases.length > 0) groups.push(new ReleaseGroupItem('Pre-releases', prereleases));
        if (drafts.length > 0) groups.push(new ReleaseGroupItem('Drafts', drafts));

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new ReleaseMessageItem(this.error, true)];
      }
    } else if (element instanceof ReleaseGroupItem) {
      return element.releases.map(r => new ReleaseTreeItem(r, this.owner, this.repo));
    }

    return [];
  }

  private async _fetchReleases(): Promise<void> {
    console.log('[Forgejo] Fetching releases...');
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.releases = [];
      return;
    }

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      this.releases = await client.listReleases(config.owner, config.repo);
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      console.log(`[Forgejo] Fetched ${this.releases.length} releases`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch releases';
      this.releases = [];
      console.error('[Forgejo] Error fetching releases:', error);
      throw error;
    }
  }
}
