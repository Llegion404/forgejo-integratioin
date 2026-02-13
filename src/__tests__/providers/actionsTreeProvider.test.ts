import * as vscode from 'vscode';
import { WorkflowRunTreeItem, JobTreeItem, StepTreeItem, ActionsTreeProvider, formatDuration } from '../../providers/actionsTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { WorkflowRunListItem, WorkflowJob } from '../../models/action';
import {
  mockWorkflowRunSuccess,
  mockWorkflowRunFailed,
  mockWorkflowRunInProgress,
  mockWorkflowRunCancelled,
  mockActionTasksResponse,
  mockEmptyActionTasksResponse,
  mockWorkflowJobSuccess,
  mockWorkflowJobFailed,
  mockWorkflowJobNoSteps,
  mockWorkflowJobsResponse,
  mockMultiJobResponse
} from '../fixtures/workflowRuns';

// Mock dependencies
jest.mock('../../api/forgejoClient');
jest.mock('../../utils/config');

describe('ActionsTreeProvider', () => {
  let provider: ActionsTreeProvider;
  let mockClient: jest.Mocked<ForgejoClient>;
  let mockGetForgejoConfig: jest.MockedFunction<typeof getForgejoConfig>;

  const mockConfig = {
    instanceUrl: 'https://git.example.com',
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'test-token'
  };

  beforeEach(() => {
    mockClient = {
      getWorkflowRuns: jest.fn(),
      getWorkflowJobs: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Default: return empty so constructor's refresh doesn't blow up
    mockClient.getWorkflowRuns.mockResolvedValue(mockEmptyActionTasksResponse);

    provider = new ActionsTreeProvider();

    jest.clearAllMocks();
  });

  describe('formatDuration', () => {
    test('should return empty string when startedAt is null', () => {
      expect(formatDuration(null, '2024-01-15T10:00:00Z')).toBe('');
    });

    test('should return empty string when completedAt is null', () => {
      expect(formatDuration('2024-01-15T10:00:00Z', null)).toBe('');
    });

    test('should return empty string when startedAt is undefined', () => {
      expect(formatDuration(undefined, '2024-01-15T10:00:00Z')).toBe('');
    });

    test('should format seconds only', () => {
      expect(formatDuration('2024-01-15T10:00:00Z', '2024-01-15T10:00:05Z')).toBe('5s');
    });

    test('should format minutes and seconds', () => {
      expect(formatDuration('2024-01-15T10:00:00Z', '2024-01-15T10:03:45Z')).toBe('3m 45s');
    });

    test('should format hours and minutes', () => {
      expect(formatDuration('2024-01-15T10:00:00Z', '2024-01-15T11:12:00Z')).toBe('1h 12m');
    });

    test('should return 0s for identical timestamps', () => {
      expect(formatDuration('2024-01-15T10:00:00Z', '2024-01-15T10:00:00Z')).toBe('0s');
    });

    test('should return empty string for negative duration', () => {
      expect(formatDuration('2024-01-15T10:05:00Z', '2024-01-15T10:00:00Z')).toBe('');
    });
  });

  describe('WorkflowRunTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('should create with correct label "Run #N"', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.label).toBe('Run #42');
    });

    test('should show short SHA + display_title in description', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.description).toBe('abc123d · Add new feature');
    });

    test('should set tooltip with workflow info', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.tooltip).toContain('Workflow: ci.yml');
      expect(item.tooltip).toContain('Branch: main');
      expect(item.tooltip).toContain('Commit: abc123def456');
      expect(item.tooltip).toContain('Add new feature');
      expect(item.tooltip).toContain('Jobs: 1');
    });

    test('should set contextValue to workflowRun', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.contextValue).toBe('workflowRun');
    });

    test('should be Collapsed (not Expanded)', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should not have a command (click expands/collapses)', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.command).toBeUndefined();
    });

    test('should show running icon when any job is in_progress', () => {
      const item = new WorkflowRunTreeItem(44, [mockWorkflowRunInProgress, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show running icon when any job is queued', () => {
      const queuedJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'queued' };
      const item = new WorkflowRunTreeItem(42, [queuedJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show running icon when any job is waiting', () => {
      const waitingJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'waiting' };
      const item = new WorkflowRunTreeItem(42, [waitingJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should show failure icon when any job failed', () => {
      const item = new WorkflowRunTreeItem(43, [mockWorkflowRunFailed, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should show success icon when all jobs succeeded', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should show cancelled icon when any job cancelled and none running/failed', () => {
      const item = new WorkflowRunTreeItem(45, [mockWorkflowRunCancelled, mockWorkflowRunSuccess], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-slash');
    });

    test('should show default icon for unknown statuses', () => {
      const unknownJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'unknown' as any };
      const item = new WorkflowRunTreeItem(42, [unknownJob], owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });
  });

  describe('JobTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';

    test('should create with job name as label', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.label).toBe('build');
    });

    test('should show status and duration in description', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.description).toBe('success · 3m 50s');
    });

    test('should show status only when no timestamps', () => {
      const jobNoTimes: WorkflowJob = { ...mockWorkflowJobSuccess, started_at: null, completed_at: null };
      const item = new JobTreeItem(jobNoTimes, 0, 42, owner, repo);
      expect(item.description).toBe('success');
    });

    test('should set tooltip with job info including run number', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.tooltip).toContain('Job: build');
      expect(item.tooltip).toContain('Status: success');
      expect(item.tooltip).toContain('Run: #42');
      expect(item.tooltip).toContain('Index: 0');
      expect(item.tooltip).toContain('Duration: 3m 50s');
    });

    test('should be Collapsed (has step children)', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('should not have a command (click expands to show steps)', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.command).toBeUndefined();
    });

    test('should set correct icon for success', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should set correct icon for failure', () => {
      const item = new JobTreeItem(mockWorkflowJobFailed, 0, 43, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should set correct icon for in_progress', () => {
      const inProgressJob: WorkflowJob = { ...mockWorkflowJobSuccess, status: 'in_progress' };
      const item = new JobTreeItem(inProgressJob, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should set correct icon for cancelled', () => {
      const cancelledJob: WorkflowJob = { ...mockWorkflowJobSuccess, status: 'cancelled' };
      const item = new JobTreeItem(cancelledJob, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-slash');
    });

    test('should set correct icon for skipped', () => {
      const skippedJob: WorkflowJob = { ...mockWorkflowJobSuccess, status: 'skipped' };
      const item = new JobTreeItem(skippedJob, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('debug-step-over');
    });

    test('should set default icon for unknown status', () => {
      const unknownJob: WorkflowJob = { ...mockWorkflowJobSuccess, status: 'unknown' as any };
      const item = new JobTreeItem(unknownJob, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });

    test('should set contextValue to workflowJob', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.contextValue).toBe('workflowJob');
    });

    test('should store runNumber', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.runNumber).toBe(42);
    });
  });

  describe('StepTreeItem', () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const step = mockWorkflowJobSuccess.steps[0]; // Checkout, 5s

    test('should create with step name as label', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.label).toBe('Checkout');
    });

    test('should show duration in description', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.description).toBe('5s');
    });

    test('should have undefined description when no timestamps', () => {
      const stepNoTimes = { ...step, started_at: undefined, completed_at: undefined };
      const item = new StepTreeItem(stepNoTimes, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.description).toBeUndefined();
    });

    test('should set tooltip with step info', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.tooltip).toContain('Step: Checkout');
      expect(item.tooltip).toContain('Status: success');
      expect(item.tooltip).toContain('Duration: 5s');
    });

    test('should be a leaf node (None collapsible state)', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    });

    test('should set contextValue to workflowStep', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.contextValue).toBe('workflowStep');
    });

    test('should set command to forgejo.viewStepLogs', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('forgejo.viewStepLogs');
      expect(item.command!.arguments).toEqual([item]);
    });

    test('should set correct icon for success', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should set correct icon for failure', () => {
      const failStep = { ...step, status: 'failure' as const };
      const item = new StepTreeItem(failStep, mockWorkflowJobSuccess, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should set correct icon for in_progress', () => {
      const runningStep = { ...step, status: 'in_progress' as const };
      const item = new StepTreeItem(runningStep, mockWorkflowJobSuccess, 0, 42, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should store job, jobIndex, runNumber, owner, repo', () => {
      const item = new StepTreeItem(step, mockWorkflowJobSuccess, 2, 42, owner, repo);
      expect(item.job).toBe(mockWorkflowJobSuccess);
      expect(item.jobIndex).toBe(2);
      expect(item.runNumber).toBe(42);
      expect(item.owner).toBe(owner);
      expect(item.repo).toBe(repo);
    });
  });

  describe('Provider getChildren - Root level', () => {
    test('should return error message when no config', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);
      mockClient.getWorkflowRuns.mockResolvedValue(mockEmptyActionTasksResponse);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('No Forgejo configuration found. Please configure instance URL or open a git repository.');
      expect(msg.contextValue).toBe('error');
    });

    test('should return empty message when no workflow runs', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRuns.mockResolvedValue(mockEmptyActionTasksResponse);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('No workflow runs found');
      expect(msg.contextValue).toBe('info');
    });

    test('should group runs by status', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRuns.mockResolvedValue(mockActionTasksResponse);

      const children = await provider.getChildren();

      // mockActionTasksResponse has: in_progress(44), failure(43), success(42), cancelled(45)
      // Each has a unique run_number, so we get 4 groups
      const labels = children.map((c: any) => c.label);
      expect(labels).toContain('Running');
      expect(labels).toContain('Failed');
      expect(labels).toContain('Success');
      expect(labels).toContain('Cancelled');
    });

    test('should sort runs by run_number descending within groups', async () => {
      const successJob2: WorkflowRunListItem = {
        ...mockWorkflowRunSuccess,
        id: 200,
        run_number: 50,
        head_sha: 'zzz999aaa111'
      };

      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRuns.mockResolvedValue({
        total_count: 2,
        workflow_runs: [mockWorkflowRunSuccess, successJob2]  // run 42 and 50
      });

      const groups = await provider.getChildren();
      expect(groups).toHaveLength(1); // Only success group

      // Get children of the success group
      const groupChildren = await provider.getChildren(groups[0]);

      expect(groupChildren).toHaveLength(2);
      // Run #50 should come first (descending)
      expect((groupChildren[0] as WorkflowRunTreeItem).runNumber).toBe(50);
      expect((groupChildren[1] as WorkflowRunTreeItem).runNumber).toBe(42);
    });

    test('should return error message on fetch failure', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowRuns.mockRejectedValue(new Error('Network error'));

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('Network error');
      expect(msg.contextValue).toBe('error');
    });
  });

  describe('Provider getChildren - WorkflowRunTreeItem (lazy job loading)', () => {
    test('should fetch jobs from API when expanding a run', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockResolvedValue(mockWorkflowJobsResponse);

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(mockClient.getWorkflowJobs).toHaveBeenCalledWith('test-owner', 'test-repo', 123); // firstJob.id
      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(JobTreeItem);
      expect((children[0] as JobTreeItem).job.name).toBe('build');
    });

    test('should cache fetched jobs on the run item', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockResolvedValue(mockWorkflowJobsResponse);

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');

      // First call - fetches from API
      await provider.getChildren(runItem);
      expect(mockClient.getWorkflowJobs).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      jest.clearAllMocks();
      const children2 = await provider.getChildren(runItem);
      expect(mockClient.getWorkflowJobs).not.toHaveBeenCalled();
      expect(children2).toHaveLength(1);
    });

    test('should return error message when job fetch fails', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockRejectedValue(new Error('API timeout'));

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(1);
      const msg = children[0] as any;
      expect(msg.label).toBe('API timeout');
      expect(msg.contextValue).toBe('error');
    });

    test('should cache error and return it on subsequent calls', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockRejectedValue(new Error('API timeout'));

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');

      // First call - hits API
      await provider.getChildren(runItem);

      // Second call - returns cached error
      jest.clearAllMocks();
      const children = await provider.getChildren(runItem);
      expect(mockClient.getWorkflowJobs).not.toHaveBeenCalled();
      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('API timeout');
    });

    test('should handle multi-job response', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockResolvedValue(mockMultiJobResponse);

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(2);
      expect((children[0] as JobTreeItem).job.name).toBe('build');
      expect((children[0] as JobTreeItem).jobIndex).toBe(0);
      expect((children[1] as JobTreeItem).job.name).toBe('deploy');
      expect((children[1] as JobTreeItem).jobIndex).toBe(1);
    });

    test('should pass runNumber to JobTreeItem', async () => {
      mockGetForgejoConfig.mockResolvedValue(mockConfig);
      mockClient.getWorkflowJobs.mockResolvedValue(mockWorkflowJobsResponse);

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect((children[0] as JobTreeItem).runNumber).toBe(42);
    });

    test('should return error when no config during job fetch', async () => {
      mockGetForgejoConfig.mockResolvedValue(null as any);

      const runItem = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], 'test-owner', 'test-repo');
      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(1);
      expect((children[0] as any).label).toBe('No Forgejo configuration found');
    });
  });

  describe('Provider getChildren - JobTreeItem (steps)', () => {
    test('should return steps as StepTreeItem children', async () => {
      const jobItem = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(children).toHaveLength(3);
      expect(children[0]).toBeInstanceOf(StepTreeItem);
      expect((children[0] as StepTreeItem).step.name).toBe('Checkout');
      expect((children[1] as StepTreeItem).step.name).toBe('Build');
      expect((children[2] as StepTreeItem).step.name).toBe('Test');
    });

    test('should return empty array for job with no steps', async () => {
      const jobItem = new JobTreeItem(mockWorkflowJobNoSteps, 0, 42, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      expect(children).toHaveLength(0);
    });

    test('should pass job metadata to StepTreeItem', async () => {
      const jobItem = new JobTreeItem(mockWorkflowJobSuccess, 1, 42, 'test-owner', 'test-repo');
      const children = await provider.getChildren(jobItem);

      const stepItem = children[0] as StepTreeItem;
      expect(stepItem.job).toBe(mockWorkflowJobSuccess);
      expect(stepItem.jobIndex).toBe(1);
      expect(stepItem.runNumber).toBe(42);
      expect(stepItem.owner).toBe('test-owner');
      expect(stepItem.repo).toBe('test-repo');
    });
  });

  describe('Provider getChildren - StepTreeItem (leaf)', () => {
    test('should return empty array for step items', async () => {
      const step = mockWorkflowJobSuccess.steps[0];
      const stepItem = new StepTreeItem(step, mockWorkflowJobSuccess, 0, 42, 'test-owner', 'test-repo');
      const children = await provider.getChildren(stepItem);

      expect(children).toHaveLength(0);
    });
  });

  describe('Provider Initialization', () => {
    test('should create provider successfully', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(ActionsTreeProvider);
    });

    test('should have onDidChangeTreeData event', () => {
      expect(provider.onDidChangeTreeData).toBeDefined();
    });

    test('should have refresh method', () => {
      expect(typeof provider.refresh).toBe('function');
    });

    test('should return element from getTreeItem', () => {
      const item = new JobTreeItem(mockWorkflowJobSuccess, 0, 42, 'owner', 'repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });
});
