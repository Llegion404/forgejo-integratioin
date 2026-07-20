import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { logError, logInfo } from '../utils/logger';

export interface Milestone {
  id: number;
  title: string;
  description?: string;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
  due_on?: string;
  created_at?: string;
  updated_at?: string;
}

export class MilestoneTreeItem extends vscode.TreeItem {
  constructor(
    public readonly milestone: Milestone,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(milestone.title, vscode.TreeItemCollapsibleState.None);
    const total = milestone.open_issues + milestone.closed_issues;
    const pct = total > 0 ? Math.round((milestone.closed_issues / total) * 100) : 0;
    this.description = `${milestone.closed_issues}/${total} (${pct}%)`;
    const due = milestone.due_on ? `\nDue: ${new Date(milestone.due_on).toLocaleDateString()}` : '';
    this.tooltip = `${milestone.title} [${milestone.state}]\n${milestone.closed_issues}/${total} issues complete${due}`;
    this.contextValue = `milestone-${milestone.state}`;
    this.iconPath = new vscode.ThemeIcon(milestone.state === 'open' ? 'milestone' : 'check-all');
    this.command = {
      command: 'forgejo.showMilestoneIssues',
      title: 'Show Milestone Issues',
      arguments: [this]
    };
  }
}

class MilestoneGroupItem extends vscode.TreeItem {
  constructor(label: string, public readonly milestones: Milestone[]) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${milestones.length}`;
    this.contextValue = 'milestoneGroup';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class MilestoneMessageItem extends vscode.TreeItem {
  constructor(message: string, isError = false) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type MilestoneTreeElement = MilestoneTreeItem | MilestoneGroupItem | MilestoneMessageItem;

export class MilestoneTreeProvider implements vscode.TreeDataProvider<MilestoneTreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MilestoneTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private milestones: Milestone[] = [];
  private error: string | null = null;
  private owner = '';
  private repo = '';
  private isSyncing = false;

  constructor() {
    void this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
    void this._sync();
  }

  getOwner(): string { return this.owner; }
  getRepo(): string { return this.repo; }

  private async _sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      await this._fetch();
    } catch (e) {
      logError('MilestoneTreeProvider fetch failed:', e);
    }
    this.isSyncing = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MilestoneTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: MilestoneTreeElement): Promise<MilestoneTreeElement[]> {
    if (element) {
      if (element instanceof MilestoneGroupItem) {
        return element.milestones.map(m => new MilestoneTreeItem(m, this.owner, this.repo));
      }
      return [];
    }
    if (this.error) return [new MilestoneMessageItem(this.error, true)];
    if (this.isSyncing && this.milestones.length === 0) {
      return [new MilestoneMessageItem('Syncing milestones...')];
    }
    if (this.milestones.length === 0) {
      return [new MilestoneMessageItem('No milestones found')];
    }
    const open = this.milestones.filter(m => m.state === 'open');
    const closed = this.milestones.filter(m => m.state === 'closed');
    const out: MilestoneTreeElement[] = [];
    if (open.length > 0) out.push(new MilestoneGroupItem('Open', open));
    if (closed.length > 0) out.push(new MilestoneGroupItem('Closed', closed));
    return out;
  }

  private async _fetch(): Promise<void> {
    const config = await getForgejoConfig();
    if (!config) {
      this.error = 'No Forgejo configuration found';
      this.milestones = [];
      return;
    }
    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const raw = await client.listMilestones(config.owner, config.repo) as Milestone[];
      this.milestones = Array.isArray(raw)
        ? raw.sort((a, b) => (a.state === 'open' ? -1 : 1) - (b.state === 'open' ? -1 : 1))
        : [];
      this.owner = config.owner;
      this.repo = config.repo;
      this.error = null;
      logInfo(`Fetched ${this.milestones.length} milestones`);
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to fetch milestones';
      this.milestones = [];
    }
  }
}
