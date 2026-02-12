import * as vscode from 'vscode';
import { WorkflowRunTreeItem, JobTreeItem, ActionsTreeProvider } from '../../providers/actionsTreeProvider';
import { ForgejoClient } from '../../api/forgejoClient';
import { getForgejoConfig } from '../../utils/config';
import { WorkflowRunListItem } from '../../models/action';
import {
  mockWorkflowRunSuccess,
  mockWorkflowRunFailed,
  mockWorkflowRunInProgress,
  mockWorkflowRunCancelled,
  mockActionTasksResponse,
  mockEmptyActionTasksResponse
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
      getWorkflowRuns: jest.fn()
    } as any;

    mockGetForgejoConfig = getForgejoConfig as jest.MockedFunction<typeof getForgejoConfig>;
    mockGetForgejoConfig.mockResolvedValue(mockConfig);

    (ForgejoClient as jest.MockedClass<typeof ForgejoClient>).mockImplementation(() => mockClient);

    // Default: return empty so constructor's refresh doesn't blow up
    mockClient.getWorkflowRuns.mockResolvedValue(mockEmptyActionTasksResponse);

    provider = new ActionsTreeProvider();

    jest.clearAllMocks();
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

    test('should set command to forgejo.showActionDetails', () => {
      const item = new WorkflowRunTreeItem(42, [mockWorkflowRunSuccess], owner, repo);
      expect(item.command).toEqual({
        command: 'forgejo.showActionDetails',
        title: 'View Action Details',
        arguments: [mockWorkflowRunSuccess, owner, repo]
      });
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
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.label).toBe('CI');
    });

    test('should show status in description', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.description).toBe('success');
    });

    test('should set tooltip with job info', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.tooltip).toBe('Job: CI\nStatus: success\nIndex: 0');
    });

    test('should set correct icon for success', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('pass');
    });

    test('should set correct icon for failure', () => {
      const item = new JobTreeItem(mockWorkflowRunFailed, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('error');
    });

    test('should set correct icon for in_progress', () => {
      const item = new JobTreeItem(mockWorkflowRunInProgress, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('sync~spin');
    });

    test('should set correct icon for cancelled', () => {
      const item = new JobTreeItem(mockWorkflowRunCancelled, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-slash');
    });

    test('should set correct icon for skipped', () => {
      const skippedJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'skipped' };
      const item = new JobTreeItem(skippedJob, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('debug-step-over');
    });

    test('should set default icon for unknown status', () => {
      const unknownJob: WorkflowRunListItem = { ...mockWorkflowRunSuccess, status: 'unknown' as any };
      const item = new JobTreeItem(unknownJob, 0, owner, repo);
      const icon = item.iconPath as vscode.ThemeIcon;
      expect(icon.id).toBe('circle-outline');
    });

    test('should set command to forgejo.showActionDetails', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.command).toEqual({
        command: 'forgejo.showActionDetails',
        title: 'View Action Details',
        arguments: [mockWorkflowRunSuccess, owner, repo]
      });
    });

    test('should set contextValue to workflowJob', () => {
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, owner, repo);
      expect(item.contextValue).toBe('workflowJob');
    });
  });

  describe('Provider getChildren', () => {
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

    test('should return job items as children of WorkflowRunTreeItem', async () => {
      const job1: WorkflowRunListItem = { ...mockWorkflowRunSuccess, id: 301, name: 'Build' };
      const job2: WorkflowRunListItem = { ...mockWorkflowRunSuccess, id: 302, name: 'Test' };

      const runItem = new WorkflowRunTreeItem(42, [job1, job2], 'owner', 'repo');

      const children = await provider.getChildren(runItem);

      expect(children).toHaveLength(2);
      expect((children[0] as JobTreeItem).job.name).toBe('Build');
      expect((children[1] as JobTreeItem).job.name).toBe('Test');
      expect((children[0] as JobTreeItem).jobIndex).toBe(0);
      expect((children[1] as JobTreeItem).jobIndex).toBe(1);
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
      const item = new JobTreeItem(mockWorkflowRunSuccess, 0, 'owner', 'repo');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });
});
