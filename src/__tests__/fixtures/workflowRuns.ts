import { ActionTasksResponse, WorkflowRun, WorkflowJobsResponse, WorkflowRunListItem, WorkflowJob } from '../../models/action';

export const mockWorkflowRunSuccess: WorkflowRunListItem = {
  id: 123,
  name: 'CI',
  run_number: 42,
  status: 'success',  // Forgejo uses status directly, not 'completed' + conclusion
  conclusion: null,
  workflow_id: 'ci.yml',
  head_branch: 'main',
  head_sha: 'abc123def456',
  event: 'push',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:05:00Z',
  url: 'https://git.example.com/owner/repo/actions/runs/42',
  display_title: 'Add new feature'
};

export const mockWorkflowRunFailed: WorkflowRunListItem = {
  id: 124,
  name: 'CI',
  run_number: 43,
  status: 'failure',  // Forgejo uses status directly
  conclusion: null,
  workflow_id: 'ci.yml',
  head_branch: 'feature/broken',
  head_sha: 'def456abc123',
  event: 'pull_request',
  created_at: '2024-01-15T11:00:00Z',
  updated_at: '2024-01-15T11:03:00Z',
  url: 'https://git.example.com/owner/repo/actions/runs/43',
  display_title: 'Fix bug'
};

export const mockWorkflowRunInProgress: WorkflowRunListItem = {
  id: 125,
  name: 'CI',
  run_number: 44,
  status: 'in_progress',
  conclusion: null,
  workflow_id: 'ci.yml',
  head_branch: 'feature/wip',
  head_sha: 'ghi789jkl012',
  event: 'push',
  created_at: '2024-01-15T12:00:00Z',
  updated_at: '2024-01-15T12:00:30Z',
  url: 'https://git.example.com/owner/repo/actions/runs/44',
  display_title: 'Work in progress'
};

export const mockWorkflowRunCancelled: WorkflowRunListItem = {
  id: 126,
  name: 'CI',
  run_number: 45,
  status: 'cancelled',  // Forgejo uses status directly
  conclusion: null,
  workflow_id: 'ci.yml',
  head_branch: 'feature/cancelled',
  head_sha: 'mno345pqr678',
  event: 'workflow_dispatch',
  created_at: '2024-01-15T13:00:00Z',
  updated_at: '2024-01-15T13:01:00Z',
  url: 'https://git.example.com/owner/repo/actions/runs/45',
  display_title: 'Manual run'
};

export const mockActionTasksResponse: ActionTasksResponse = {
  total_count: 4,
  workflow_runs: [
    mockWorkflowRunInProgress,
    mockWorkflowRunFailed,
    mockWorkflowRunSuccess,
    mockWorkflowRunCancelled
  ]
};

export const mockEmptyActionTasksResponse: ActionTasksResponse = {
  total_count: 0,
  workflow_runs: []
};

export const mockWorkflowRunDetails: WorkflowRun = {
  ...mockWorkflowRunSuccess,
  started_at: '2024-01-15T10:00:05Z',
  stopped_at: '2024-01-15T10:05:00Z',
  run_started_at: '2024-01-15T10:00:05Z'
};

export const mockWorkflowJobSuccess: WorkflowJob = {
  id: 201,
  run_id: 123,
  name: 'build',
  status: 'success',
  conclusion: null,
  started_at: '2024-01-15T10:00:10Z',
  completed_at: '2024-01-15T10:04:00Z',
  html_url: 'https://git.example.com/owner/repo/actions/runs/42/jobs/0',
  steps: [
    {
      name: 'Checkout',
      status: 'success',
      conclusion: null,
      number: 1,
      started_at: '2024-01-15T10:00:10Z',
      completed_at: '2024-01-15T10:00:15Z'
    },
    {
      name: 'Build',
      status: 'success',
      conclusion: null,
      number: 2,
      started_at: '2024-01-15T10:00:15Z',
      completed_at: '2024-01-15T10:03:00Z'
    },
    {
      name: 'Test',
      status: 'success',
      conclusion: null,
      number: 3,
      started_at: '2024-01-15T10:03:00Z',
      completed_at: '2024-01-15T10:04:00Z'
    }
  ]
};

export const mockWorkflowJobFailed: WorkflowJob = {
  id: 202,
  run_id: 124,
  name: 'build',
  status: 'failure',
  conclusion: null,
  started_at: '2024-01-15T11:00:10Z',
  completed_at: '2024-01-15T11:03:00Z',
  html_url: 'https://git.example.com/owner/repo/actions/runs/43/jobs/0',
  steps: [
    {
      name: 'Checkout',
      status: 'success',
      conclusion: null,
      number: 1
    },
    {
      name: 'Build',
      status: 'failure',
      conclusion: null,
      number: 2
    }
  ]
};

export const mockWorkflowJobNoSteps: WorkflowJob = {
  id: 203,
  run_id: 123,
  name: 'deploy',
  status: 'success',
  conclusion: null,
  started_at: '2024-01-15T10:05:00Z',
  completed_at: '2024-01-15T10:06:00Z',
  html_url: 'https://git.example.com/owner/repo/actions/runs/42/jobs/1',
  steps: []
};

export const mockMultiJobResponse: WorkflowJobsResponse = {
  total_count: 2,
  jobs: [mockWorkflowJobSuccess, mockWorkflowJobNoSteps]
};

export const mockWorkflowJobsResponse: WorkflowJobsResponse = {
  total_count: 1,
  jobs: [mockWorkflowJobSuccess]
};

export const mockEmptyWorkflowJobsResponse: WorkflowJobsResponse = {
  total_count: 0,
  jobs: []
};

export const mockWorkflowLogs = `2024-01-15T10:00:10Z Starting job: build
2024-01-15T10:00:10Z Checkout repository...
2024-01-15T10:00:15Z Checkout completed successfully
2024-01-15T10:00:15Z Running build...
2024-01-15T10:03:00Z Build completed successfully
2024-01-15T10:03:00Z Running tests...
2024-01-15T10:04:00Z All tests passed
2024-01-15T10:04:00Z Job completed successfully`;
