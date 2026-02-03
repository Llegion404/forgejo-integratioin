import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { WorkflowRunListItem } from '../models/action';
import { getForgejoConfig } from '../utils/config';

/**
 * Represents a grouped workflow run (parent of jobs)
 */
export class WorkflowRunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly runNumber: number,
    public readonly jobs: WorkflowRunListItem[],
    public readonly owner: string,
    public readonly repo: string
  ) {
    // Use first job to get run metadata (all jobs in same run share these)
    const firstJob = jobs[0];
    const shortSha = firstJob.head_sha.substring(0, 7);
    const label = `Run #${runNumber}`;

    super(label, vscode.TreeItemCollapsibleState.Expanded);

    // Description shows commit info
    this.description = `${shortSha} · ${firstJob.display_title}`;
    this.tooltip = `Workflow: ${firstJob.workflow_id}\nBranch: ${firstJob.head_branch}\nCommit: ${firstJob.head_sha}\n${firstJob.display_title}\nJobs: ${jobs.length}`;
    this.contextValue = 'workflowRun';

    // Icon based on aggregate status
    this.iconPath = this.getAggregateStatusIcon(jobs);

    // Click to open action details panel (use first job's data)
    this.command = {
      command: 'forgejo.showActionDetails',
      title: 'View Action Details',
      arguments: [firstJob, owner, repo]
    };
  }

  private getAggregateStatusIcon(jobs: WorkflowRunListItem[]): vscode.ThemeIcon {
    // If any job is running, show running icon
    if (jobs.some(j => j.status === 'in_progress' || j.status === 'queued' || j.status === 'waiting')) {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }
    // If any job failed, show failure
    if (jobs.some(j => j.status === 'failure')) {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }
    // If all succeeded
    if (jobs.every(j => j.status === 'success')) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    // If any cancelled
    if (jobs.some(j => j.status === 'cancelled')) {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    }
    return new vscode.ThemeIcon('circle-outline');
  }
}

/**
 * Represents a single job within a workflow run
 */
export class JobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly job: WorkflowRunListItem,
    public readonly jobIndex: number,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(job.name, vscode.TreeItemCollapsibleState.None);

    this.description = job.status;
    this.tooltip = `Job: ${job.name}\nStatus: ${job.status}\nIndex: ${jobIndex}`;
    this.contextValue = 'workflowJob';

    // Set icon based on status
    this.iconPath = this.getStatusIcon(job.status);

    // Click to open action details panel
    this.command = {
      command: 'forgejo.showActionDetails',
      title: 'View Action Details',
      arguments: [job, owner, repo]
    };
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
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
    public readonly groupLabel: string,
    public readonly runs: Map<number, WorkflowRunListItem[]>,  // run_number -> jobs
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(groupLabel, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${runs.size}`;
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

type ActionTreeElement = WorkflowRunTreeItem | JobTreeItem | ActionGroupItem | ActionMessageItem;

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

        // Group jobs by run_number first
        const runsByNumber = new Map<number, WorkflowRunListItem[]>();
        for (const job of this.workflowRuns) {
          const existing = runsByNumber.get(job.run_number) || [];
          existing.push(job);
          runsByNumber.set(job.run_number, existing);
        }

        // Determine aggregate status for each run
        const getRunStatus = (jobs: WorkflowRunListItem[]): string => {
          if (jobs.some(j => j.status === 'in_progress' || j.status === 'queued' || j.status === 'waiting')) {
            return 'running';
          }
          if (jobs.some(j => j.status === 'failure')) {
            return 'failed';
          }
          if (jobs.every(j => j.status === 'success')) {
            return 'success';
          }
          if (jobs.some(j => j.status === 'cancelled' || j.status === 'skipped')) {
            return 'cancelled';
          }
          return 'other';
        };

        // Group runs by aggregate status
        const running = new Map<number, WorkflowRunListItem[]>();
        const failed = new Map<number, WorkflowRunListItem[]>();
        const success = new Map<number, WorkflowRunListItem[]>();
        const cancelled = new Map<number, WorkflowRunListItem[]>();

        for (const [runNumber, jobs] of runsByNumber) {
          const status = getRunStatus(jobs);
          switch (status) {
            case 'running':
              running.set(runNumber, jobs);
              break;
            case 'failed':
              failed.set(runNumber, jobs);
              break;
            case 'success':
              success.set(runNumber, jobs);
              break;
            case 'cancelled':
              cancelled.set(runNumber, jobs);
              break;
          }
        }

        const groups: ActionGroupItem[] = [];

        if (running.size > 0) {
          groups.push(new ActionGroupItem('Running', running, this.owner, this.repo));
        }
        if (failed.size > 0) {
          groups.push(new ActionGroupItem('Failed', failed, this.owner, this.repo));
        }
        if (success.size > 0) {
          groups.push(new ActionGroupItem('Success', success, this.owner, this.repo));
        }
        if (cancelled.size > 0) {
          groups.push(new ActionGroupItem('Cancelled', cancelled, this.owner, this.repo));
        }

        return groups;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new ActionMessageItem(this.error, true)];
      }
    } else if (element instanceof ActionGroupItem) {
      // Show runs in this status group
      const runItems: WorkflowRunTreeItem[] = [];
      // Sort by run_number descending (newest first)
      const sortedRuns = Array.from(element.runs.entries()).sort((a, b) => b[0] - a[0]);
      for (const [runNumber, jobs] of sortedRuns) {
        runItems.push(new WorkflowRunTreeItem(runNumber, jobs, element.owner, element.repo));
      }
      return runItems;
    } else if (element instanceof WorkflowRunTreeItem) {
      // Show jobs within this run
      return element.jobs.map((job, index) =>
        new JobTreeItem(job, index, element.owner, element.repo)
      );
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
