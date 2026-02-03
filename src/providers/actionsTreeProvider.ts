import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { WorkflowRunListItem } from '../models/action';
import { getForgejoConfig } from '../utils/config';

/**
 * Represents a workflow job/task in the tree
 * Note: Forgejo's /actions/tasks endpoint returns individual jobs, not workflow runs
 */
export class ActionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly run: WorkflowRunListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    // Use job name (e.g., "test (20)") as label, not expandable since these ARE the jobs
    super(run.name, vscode.TreeItemCollapsibleState.None);

    const statusText = run.status;
    this.tooltip = `Job: ${run.name}\nCommit: ${run.display_title}\nWorkflow: ${run.workflow_id}\nBranch: ${run.head_branch}\nStatus: ${statusText}\nEvent: ${run.event}`;
    this.description = `#${run.run_number} · ${run.head_branch}`;
    this.contextValue = 'workflowRun';

    // Set icon based on status
    this.iconPath = this.getStatusIcon(run.status);

    // Click to open action details panel
    this.command = {
      command: 'forgejo.showActionDetails',
      title: 'View Action Details',
      arguments: [run, owner, repo]
    };
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    // Forgejo uses status directly (success, failure, cancelled)
    // NOT status='completed' + conclusion like GitHub Actions
    switch (status) {
      case 'in_progress':
      case 'queued':
      case 'waiting':
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
      case 'success':
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      case 'failure':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'cancelled':
        return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
      case 'skipped':
        return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('disabledForeground'));
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

/**
 * Groups workflow runs by status
 */
class ActionGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly runs: WorkflowRunListItem[],
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${runs.length}`;
    this.contextValue = 'actionGroup';
  }
}

/**
 * Message item for errors or info
 */
class ActionMessageItem extends vscode.TreeItem {
  constructor(
    public readonly message: string,
    public readonly isError: boolean = false
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isError ? 'error' : 'info');
    this.contextValue = isError ? 'error' : 'info';
  }
}

type ActionTreeElement = ActionTreeItem | ActionGroupItem | ActionMessageItem;

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionTreeElement> {
  private _onDidChangeTreeData: vscode.EventEmitter<ActionTreeElement | undefined | null | void> = new vscode.EventEmitter<ActionTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ActionTreeElement | undefined | null | void> = this._onDidChangeTreeData.event;

  private workflowRuns: WorkflowRunListItem[] = [];
  private error: string | null = null;
  private owner: string = '';
  private repo: string = '';

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ActionTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ActionTreeElement): Promise<ActionTreeElement[]> {
    if (!element) {
      // Root level - fetch workflow runs and group them
      try {
        await this.fetchWorkflowRuns();

        if (this.error) {
          console.error('[Forgejo] Actions fetch error:', this.error);
          return [new ActionMessageItem(this.error, true)];
        }

        if (this.workflowRuns.length === 0) {
          return [new ActionMessageItem('No workflow runs found', false)];
        }

        // Group by status
        // Note: Forgejo uses status directly (success, failure, cancelled)
        // NOT status='completed' + conclusion like GitHub Actions
        const running = this.workflowRuns.filter(r =>
          r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting'
        );
        const success = this.workflowRuns.filter(r => r.status === 'success');
        const failed = this.workflowRuns.filter(r => r.status === 'failure');
        const cancelled = this.workflowRuns.filter(r =>
          r.status === 'cancelled' || r.status === 'skipped'
        );

        const groups: ActionGroupItem[] = [];

        if (running.length > 0) {
          groups.push(new ActionGroupItem('Running', running, this.owner, this.repo));
        }
        if (failed.length > 0) {
          groups.push(new ActionGroupItem('Failed', failed, this.owner, this.repo));
        }
        if (success.length > 0) {
          groups.push(new ActionGroupItem('Success', success, this.owner, this.repo));
        }
        if (cancelled.length > 0) {
          groups.push(new ActionGroupItem('Cancelled', cancelled, this.owner, this.repo));
        }

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new ActionMessageItem(this.error, true)];
      }
    } else if (element instanceof ActionGroupItem) {
      // Show jobs in this group (Forgejo's /actions/tasks returns jobs, not runs)
      return element.runs.map(run => new ActionTreeItem(run, element.owner, element.repo));
    }

    return [];
  }

  private async fetchWorkflowRuns(): Promise<void> {
    console.log('[Forgejo] Fetching workflow runs...');
    const config = await getForgejoConfig();

    if (!config) {
      this.error = 'No Forgejo configuration found. Please configure instance URL or open a git repository.';
      this.workflowRuns = [];
      console.warn('[Forgejo] No config found');
      return;
    }

    this.owner = config.owner;
    this.repo = config.repo;

    console.log('[Forgejo] Using config for Actions:', {
      instanceUrl: config.instanceUrl,
      owner: config.owner,
      repo: config.repo,
      hasToken: !!config.token
    });

    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);
      const response = await client.getWorkflowRuns(config.owner, config.repo);
      this.workflowRuns = response.workflow_runs || [];
      this.error = null;
      console.log(`[Forgejo] Fetched ${this.workflowRuns.length} workflow runs`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to fetch workflow runs';
      this.workflowRuns = [];
      console.error('[Forgejo] Error fetching workflow runs:', error);
      throw error;
    }
  }
}
