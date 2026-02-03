import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { WorkflowRunListItem, WorkflowJob, WorkflowRunConclusion } from '../models/action';
import { getForgejoConfig } from '../utils/config';

/**
 * Represents a workflow run in the tree
 */
export class ActionTreeItem extends vscode.TreeItem {
  public jobs?: WorkflowJob[];
  public jobsError?: string;

  constructor(
    public readonly run: WorkflowRunListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(run.display_title || run.name, vscode.TreeItemCollapsibleState.Collapsed);

    const statusText = run.conclusion || run.status;
    this.tooltip = `${run.display_title || run.name}\nWorkflow: ${run.workflow_id}\nBranch: ${run.head_branch}\nStatus: ${statusText}\nEvent: ${run.event}`;
    this.description = `#${run.run_number} · ${run.head_branch}`;
    this.contextValue = 'workflowRun';

    // Set icon based on status/conclusion
    this.iconPath = this.getStatusIcon(run.status, run.conclusion);
  }

  private getStatusIcon(status: string, conclusion: WorkflowRunConclusion | null): vscode.ThemeIcon {
    if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }

    switch (conclusion) {
      case 'success':
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      case 'failure':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'cancelled':
        return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
      case 'skipped':
        return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('disabledForeground'));
      case 'timed_out':
        return new vscode.ThemeIcon('watch', new vscode.ThemeColor('testing.iconFailed'));
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

/**
 * Represents a job within a workflow run
 */
class ActionJobItem extends vscode.TreeItem {
  constructor(
    public readonly job: WorkflowJob,
    public readonly run: WorkflowRunListItem,
    public readonly owner: string,
    public readonly repo: string
  ) {
    super(job.name, vscode.TreeItemCollapsibleState.None);

    const statusText = job.conclusion || job.status;
    this.tooltip = `Job: ${job.name}\nStatus: ${statusText}`;
    this.description = statusText;
    this.contextValue = 'workflowJob';

    // Set icon based on job status
    this.iconPath = this.getStatusIcon(job.status, job.conclusion);

    // Command to view logs
    this.command = {
      command: 'forgejo.viewActionLogs',
      title: 'View Logs',
      arguments: [run, job, owner, repo]
    };
  }

  private getStatusIcon(status: string, conclusion: WorkflowRunConclusion | null): vscode.ThemeIcon {
    if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }

    switch (conclusion) {
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
 * Loading indicator
 */
class ActionLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading jobs...', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'loading';
  }
}

type ActionTreeElement = ActionTreeItem | ActionGroupItem | ActionMessageItem | ActionJobItem | ActionLoadingItem;

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

        // Group by status/conclusion
        const running = this.workflowRuns.filter(r =>
          r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting'
        );
        const success = this.workflowRuns.filter(r =>
          r.status === 'completed' && r.conclusion === 'success'
        );
        const failed = this.workflowRuns.filter(r =>
          r.status === 'completed' && r.conclusion === 'failure'
        );
        const cancelled = this.workflowRuns.filter(r =>
          r.status === 'completed' && (r.conclusion === 'cancelled' || r.conclusion === 'skipped')
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
      // Show workflow runs in this group
      return element.runs.map(run => new ActionTreeItem(run, element.owner, element.repo));
    } else if (element instanceof ActionTreeItem) {
      // Fetch and show jobs for this workflow run
      return this.getRunJobs(element);
    }

    return [];
  }

  /**
   * Fetch jobs for a workflow run (lazy loading with caching)
   */
  private async getRunJobs(runItem: ActionTreeItem): Promise<ActionTreeElement[]> {
    // Return cached jobs if available
    if (runItem.jobs) {
      return runItem.jobs.map(job =>
        new ActionJobItem(job, runItem.run, runItem.owner, runItem.repo)
      );
    }

    // Return error if previous fetch failed
    if (runItem.jobsError) {
      return [new ActionMessageItem(runItem.jobsError, true)];
    }

    // Fetch jobs from API
    try {
      const config = await getForgejoConfig();
      if (!config) {
        return [new ActionMessageItem('Configuration not available', true)];
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      console.log(`[Forgejo] Fetching jobs for workflow run #${runItem.run.run_number}...`);

      const response = await client.getWorkflowJobs(runItem.owner, runItem.repo, runItem.run.id);

      // Cache the results
      runItem.jobs = response.jobs;

      console.log(`[Forgejo] Fetched ${response.jobs.length} jobs for workflow run #${runItem.run.run_number}`);

      if (response.jobs.length === 0) {
        return [new ActionMessageItem('No jobs found', false)];
      }

      return response.jobs.map(job =>
        new ActionJobItem(job, runItem.run, runItem.owner, runItem.repo)
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch jobs';
      runItem.jobsError = errorMsg;
      console.error(`[Forgejo] Error fetching jobs for workflow run #${runItem.run.run_number}:`, error);
      return [new ActionMessageItem(errorMsg, true)];
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
