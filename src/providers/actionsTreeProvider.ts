import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { WorkflowRunListItem, WorkflowJob, WorkflowStep } from '../models/action';
import { getForgejoConfig } from '../utils/config';

/**
 * Format a duration between two ISO timestamps as a human-readable string.
 * Returns "" when either timestamp is null/undefined.
 */
export function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined): string {
  if (!startedAt || !completedAt) {
    return '';
  }
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0 || isNaN(ms)) {
    return '';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Get a status icon for a workflow status string.
 */
function getStatusIcon(status: string): vscode.ThemeIcon {
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

/**
 * Represents a grouped workflow run (parent of jobs).
 * Expanding this node lazy-loads jobs from the API.
 */
export class WorkflowRunTreeItem extends vscode.TreeItem {
  /** Cached jobs fetched from the API */
  fetchedJobs?: WorkflowJob[];
  /** Error from the last job fetch attempt */
  fetchError?: string;

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

    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    // Description shows commit info
    this.description = `${shortSha} · ${firstJob.display_title}`;
    this.tooltip = `Workflow: ${firstJob.workflow_id}\nBranch: ${firstJob.head_branch}\nCommit: ${firstJob.head_sha}\n${firstJob.display_title}\nJobs: ${jobs.length}`;
    this.contextValue = 'workflowRun';

    // Icon based on aggregate status
    this.iconPath = this.getAggregateStatusIcon(jobs);
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
 * Represents a single job within a workflow run (parent of steps).
 */
export class JobTreeItem extends vscode.TreeItem {
  constructor(
    public readonly job: WorkflowJob,
    public readonly jobIndex: number,
    public readonly runNumber: number,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(job.name, vscode.TreeItemCollapsibleState.Collapsed);

    const duration = formatDuration(job.started_at, job.completed_at);
    this.description = duration ? `${job.status} · ${duration}` : job.status;
    this.tooltip = `Job: ${job.name}\nStatus: ${job.status}\nRun: #${runNumber}\nIndex: ${jobIndex}${duration ? `\nDuration: ${duration}` : ''}`;
    this.contextValue = 'workflowJob';

    // Set icon based on status
    this.iconPath = getStatusIcon(job.status);
  }
}

/**
 * Represents a single step within a workflow job (leaf node).
 */
export class StepTreeItem extends vscode.TreeItem {
  constructor(
    public readonly step: WorkflowStep,
    public readonly job: WorkflowJob,
    public readonly jobIndex: number,
    public readonly runNumber: number,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(step.name, vscode.TreeItemCollapsibleState.None);

    const duration = formatDuration(step.started_at, step.completed_at);
    this.description = duration || undefined;
    this.tooltip = `Step: ${step.name}\nStatus: ${step.status}${duration ? `\nDuration: ${duration}` : ''}`;
    this.contextValue = 'workflowStep';

    this.iconPath = getStatusIcon(step.status);

    // Click to view step logs
    this.command = {
      command: 'forgejo.viewStepLogs',
      title: 'View Step Logs',
      arguments: [this]
    };
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

type ActionTreeElement = WorkflowRunTreeItem | JobTreeItem | StepTreeItem | ActionMessageItem;

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
      // Root level - fetch workflow runs and list chronologically (newest first)
      try {
        await this.fetchWorkflowRuns();

        if (this.error) {
          console.error('[Forgejo] Actions fetch error:', this.error);
          return [new ActionMessageItem(this.error, true)];
        }

        if (this.workflowRuns.length === 0) {
          return [new ActionMessageItem('No workflow runs found', false)];
        }

        // Group jobs by run_number
        const runsByNumber = new Map<number, WorkflowRunListItem[]>();
        for (const job of this.workflowRuns) {
          const existing = runsByNumber.get(job.run_number) || [];
          existing.push(job);
          runsByNumber.set(job.run_number, existing);
        }

        // Sort by run_number descending (newest first)
        const sortedRuns = Array.from(runsByNumber.entries()).sort((a, b) => b[0] - a[0]);
        return sortedRuns.map(([runNumber, jobs]) =>
          new WorkflowRunTreeItem(runNumber, jobs, this.owner, this.repo)
        );
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unknown error';
        return [new ActionMessageItem(this.error, true)];
      }
    } else if (element instanceof WorkflowRunTreeItem) {
      // Lazy-load jobs from the API
      return this.getRunJobs(element);
    } else if (element instanceof JobTreeItem) {
      // Return steps from the job data
      return (element.job.steps || []).map(step =>
        new StepTreeItem(step, element.job, element.jobIndex, element.runNumber, element.owner, element.repo)
      );
    }

    return [];
  }

  /**
   * Lazy-load jobs for a workflow run from the API.
   * Results are cached on the WorkflowRunTreeItem.
   */
  private async getRunJobs(runItem: WorkflowRunTreeItem): Promise<ActionTreeElement[]> {
    // Return cached result if available
    if (runItem.fetchedJobs) {
      return runItem.fetchedJobs.map((job, index) =>
        new JobTreeItem(job, index, runItem.runNumber, runItem.owner, runItem.repo)
      );
    }
    if (runItem.fetchError) {
      return [new ActionMessageItem(runItem.fetchError, true)];
    }

    try {
      const config = await getForgejoConfig();
      if (!config) {
        const err = 'No Forgejo configuration found';
        runItem.fetchError = err;
        return [new ActionMessageItem(err, true)];
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      // Use the first job's id as the run_id for the API call
      const firstJob = runItem.jobs[0];
      const runId = firstJob.id;
      const jobsResponse = await client.getWorkflowJobs(config.owner, config.repo, runId);

      runItem.fetchedJobs = jobsResponse.jobs;
      return jobsResponse.jobs.map((job, index) =>
        new JobTreeItem(job, index, runItem.runNumber, runItem.owner, runItem.repo)
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to fetch jobs';
      runItem.fetchError = errMsg;
      console.error('[Forgejo] Error fetching jobs for run:', error);
      return [new ActionMessageItem(errMsg, true)];
    }
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
