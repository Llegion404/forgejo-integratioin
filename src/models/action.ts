/**
 * Response from the /repos/{owner}/{repo}/actions/tasks endpoint
 */
export interface ActionTasksResponse {
  total_count: number;
  workflow_runs: WorkflowRunListItem[];
}

/**
 * Summary item for workflow runs in list view
 */
export interface WorkflowRunListItem {
  id: number;
  name: string;
  run_number: number;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion | null;
  workflow_id: string;
  head_branch: string;
  head_sha: string;
  event: WorkflowEvent;
  created_at: string;
  updated_at: string;
  html_url: string;
  display_title: string;
}

/**
 * Full workflow run details from /repos/{owner}/{repo}/actions/runs/{run_id}
 */
export interface WorkflowRun extends WorkflowRunListItem {
  started_at: string | null;
  stopped_at: string | null;
  run_started_at: string;
}

/**
 * Workflow job details from /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
 */
export interface WorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion | null;
  started_at: string | null;
  completed_at: string | null;
  steps: WorkflowStep[];
  html_url?: string;
}

/**
 * Step within a workflow job
 */
export interface WorkflowStep {
  name: string;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion | null;
  number: number;
  started_at?: string;
  completed_at?: string;
}

/**
 * Response from /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
 */
export interface WorkflowJobsResponse {
  total_count: number;
  jobs: WorkflowJob[];
}

/**
 * Workflow run status
 */
export type WorkflowRunStatus = 'waiting' | 'queued' | 'in_progress' | 'completed';

/**
 * Workflow run conclusion (only set when status is 'completed')
 */
export type WorkflowRunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'timed_out' | 'action_required';

/**
 * Events that can trigger a workflow
 */
export type WorkflowEvent =
  | 'push'
  | 'pull_request'
  | 'pull_request_target'
  | 'schedule'
  | 'workflow_dispatch'
  | 'repository_dispatch'
  | 'release'
  | 'create'
  | 'delete'
  | 'fork'
  | 'issues'
  | 'issue_comment'
  | 'watch'
  | string; // Allow other events
