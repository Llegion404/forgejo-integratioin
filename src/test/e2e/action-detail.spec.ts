import { test, expect } from '@playwright/test';
import {
  WebviewHarness,
  getPostedMessages,
  createMockActionData,
} from './fixtures/webview-harness';

test.describe('Action Detail Webview', () => {
  let harness: WebviewHarness;

  test.beforeEach(async ({ page }) => {
    harness = new WebviewHarness(page);
    await harness.loadActionDetail();
  });

  test('shows loading state initially', async ({ page }) => {
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();

    const content = page.locator('#content');
    await expect(content).toBeHidden();
  });

  test('sends ready message on initialization', async ({ page }) => {
    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'ready' });
  });

  test('displays action name and run number', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({
      name: 'Build & Test',
      run_number: 42,
    }));

    await expect(page.locator('#action-name')).toHaveText('Build & Test');
    await expect(page.locator('#run-number')).toHaveText('#42');
  });

  test('shows SUCCESS health badge for success status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'success' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('SUCCESS');
    await expect(badge).toHaveClass(/\bsuccess\b/);
  });

  test('shows FAILURE health badge for failure status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'failure' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('FAILURE');
    await expect(badge).toHaveClass(/\bfailure\b/);
  });

  test('shows RUNNING health badge for in_progress status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'in_progress' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('RUNNING');
    await expect(badge).toHaveClass(/\brunning\b/);
  });

  test('shows QUEUED health badge for queued status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'queued' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('QUEUED');
    await expect(badge).toHaveClass(/\bqueued\b/);
  });

  test('shows WAITING health badge for waiting status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'waiting' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('WAITING');
    await expect(badge).toHaveClass(/\bwaiting\b/);
  });

  test('shows CANCELLED health badge for cancelled status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'cancelled' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('CANCELLED');
    await expect(badge).toHaveClass(/\bcancelled\b/);
  });

  test('shows SKIPPED health badge for skipped status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'skipped' }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('SKIPPED');
    await expect(badge).toHaveClass(/\bskipped\b/);
  });

  test('shows uppercased status for unknown status', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ status: 'pending' as any }));

    const badge = page.locator('#health-badge');
    await expect(badge).toHaveText('PENDING');
  });

  test('displays health stats with job counts', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'build', status: 'success', steps: [] },
      { id: 2, run_id: 1, name: 'test', status: 'success', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('#health-stats')).toHaveText('2 of 2 jobs passed');
  });

  test('displays health stats with failures', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'build', status: 'success', steps: [] },
      { id: 2, run_id: 1, name: 'test', status: 'failure', steps: [] },
      { id: 3, run_id: 1, name: 'lint', status: 'success', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({ status: 'failure' }, jobs));

    const stats = page.locator('#health-stats');
    await expect(stats).toContainText('2 of 3 jobs passed');
    await expect(stats).toContainText('1 failed');
  });

  test('shows "No jobs" when jobs array is empty', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData());

    await expect(page.locator('#health-stats')).toHaveText('No jobs');
  });

  test('displays commit info with short SHA', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({
      head_sha: 'deadbeef12345678',
      display_title: 'Add feature X',
    }));

    await expect(page.locator('#commit-info')).toHaveText('deadbee - Add feature X');
  });

  test('displays branch name', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({
      head_branch: 'feature/awesome',
    }));

    await expect(page.locator('#branch-name')).toHaveText('feature/awesome');
  });

  test('displays formatted event type for push', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ event: 'push' }));

    await expect(page.locator('#event-type')).toHaveText('push');
  });

  test('displays formatted event type for pull_request', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ event: 'pull_request' }));

    await expect(page.locator('#event-type')).toHaveText('pull request');
  });

  test('displays formatted event type for workflow_dispatch', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ event: 'workflow_dispatch' }));

    await expect(page.locator('#event-type')).toHaveText('manual');
  });

  test('displays formatted event type for schedule', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ event: 'schedule' }));

    await expect(page.locator('#event-type')).toHaveText('schedule');
  });

  test('displays duration', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({
      started_at: '2025-01-15T10:00:00Z',
      stopped_at: '2025-01-15T10:02:30Z',
    }));

    await expect(page.locator('#duration')).toHaveText('2m 30s');
  });

  test('displays "Unnamed Workflow" when name is empty', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData({ name: '' }));

    await expect(page.locator('#action-name')).toHaveText('Unnamed Workflow');
  });

  test('renders jobs list with correct count', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'build', status: 'success', steps: [] },
      { id: 2, run_id: 1, name: 'test', status: 'failure', steps: [] },
      { id: 3, run_id: 1, name: 'deploy', status: 'skipped', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('#jobs-count')).toHaveText('(3)');
    await expect(page.locator('.job-item')).toHaveCount(3);
  });

  test('renders job names', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'Build Application', status: 'success', steps: [] },
      { id: 2, run_id: 1, name: 'Run Tests', status: 'success', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    const jobNames = page.locator('.job-name');
    await expect(jobNames.first()).toHaveText('Build Application');
    await expect(jobNames.last()).toHaveText('Run Tests');
  });

  test('renders job with success status border', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'build', status: 'success', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('.job-header').first()).toHaveClass(/\bsuccess\b/);
  });

  test('renders job with failure status border', async ({ page }) => {
    const jobs = [
      { id: 1, run_id: 1, name: 'test', status: 'failure', steps: [] },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('.job-header').first()).toHaveClass(/\bfailure\b/);
  });

  test('shows expand icon for jobs with steps', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [{ name: 'Checkout', status: 'success', number: 1 }],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('.job-expand-icon')).toHaveCount(1);
  });

  test('hides steps by default (collapsed)', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [{ name: 'Checkout', status: 'success', number: 1 }],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    const stepsList = page.locator('.steps-list');
    await expect(stepsList).toBeHidden();
  });

  test('expands steps on job header click', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [
          { name: 'Checkout', status: 'success', number: 1 },
          { name: 'Build', status: 'success', number: 2 },
        ],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await page.locator('.job-header').first().click();

    const jobItem = page.locator('.job-item').first();
    await expect(jobItem).toHaveClass(/\bexpanded\b/);

    const steps = page.locator('.step-item');
    // 2 steps + 1 "View Logs" button row
    await expect(steps).toHaveCount(3);
    await expect(page.locator('.step-name').first()).toHaveText('Checkout');
    await expect(page.locator('.step-name').last()).toHaveText('Build');
  });

  test('shows failures section when steps fail', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'Build Job', status: 'failure',
        steps: [
          { name: 'Checkout', status: 'success', number: 1 },
          { name: 'Run tests', status: 'failure', number: 2 },
        ],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({ status: 'failure' }, jobs));

    await expect(page.locator('#failures-section')).toBeVisible();
    await expect(page.locator('.failure-item')).toHaveCount(1);
    await expect(page.locator('.failure-job-name')).toHaveText('Build Job');
    await expect(page.locator('.failure-step-name')).toHaveText('Run tests');
  });

  test('hides failures section when no failures', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [{ name: 'Checkout', status: 'success', number: 1 }],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    await expect(page.locator('#failures-section')).toBeHidden();
  });

  test('displays multiple failure items', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'Job A', status: 'failure',
        steps: [
          { name: 'Step 1', status: 'failure', number: 1 },
        ],
      },
      {
        id: 2, run_id: 1, name: 'Job B', status: 'failure',
        steps: [
          { name: 'Step X', status: 'success', number: 1 },
          { name: 'Step Y', status: 'failure', number: 2 },
        ],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({ status: 'failure' }, jobs));

    await expect(page.locator('.failure-item')).toHaveCount(2);
  });

  test('shows "(0)" jobs count when no jobs', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData());

    await expect(page.locator('#jobs-count')).toHaveText('(0)');
  });

  test('sends refresh message on refresh click', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData());

    await page.locator('#refresh-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('sends rerun message on rerun click', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData());

    await page.locator('#rerun-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'rerun' });
  });

  test('sends openInBrowser message', async ({ page }) => {
    await harness.sendActionUpdate(createMockActionData());

    await page.locator('#open-web-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages).toContainEqual({ type: 'openInBrowser' });
  });

  test('sends viewLogs message on View Logs click', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [{ name: 'Checkout', status: 'success', number: 1 }],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    // Expand the job first
    await page.locator('.job-header').first().click();
    await page.locator('.view-logs-btn').first().click();

    const messages = await getPostedMessages(page);
    const viewLogsMsg = messages.find(m => m.type === 'viewLogs');
    expect(viewLogsMsg).toBeDefined();
    expect(viewLogsMsg).toMatchObject({ type: 'viewLogs', jobIndex: 0 });
  });

  test('shows error state', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Failed to load action' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText('Failed to load action');
    await expect(page.locator('#content')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();
  });

  test('retry button sends refresh message', async ({ page }) => {
    await harness.postMessage({ type: 'error', message: 'Error' });
    await expect(page.locator('#error')).toBeVisible();

    await page.locator('#retry-btn').click();

    const messages = await getPostedMessages(page);
    expect(messages.filter(m => m.type === 'refresh')).not.toHaveLength(0);
  });

  test('toggles job expansion on second click', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'success',
        steps: [{ name: 'Checkout', status: 'success', number: 1 }],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({}, jobs));

    const jobHeader = page.locator('.job-header').first();
    const jobItem = page.locator('.job-item').first();

    // Expand
    await jobHeader.click();
    await expect(jobItem).toHaveClass(/\bexpanded\b/);

    // Collapse
    await jobHeader.click();
    await expect(jobItem).not.toHaveClass(/\bexpanded\b/);
  });

  test('marks failing steps with failing class', async ({ page }) => {
    const jobs = [
      {
        id: 1, run_id: 1, name: 'build', status: 'failure',
        steps: [
          { name: 'Checkout', status: 'success', number: 1 },
          { name: 'Build', status: 'failure', number: 2 },
        ],
      },
    ];
    await harness.sendActionUpdate(createMockActionData({ status: 'failure' }, jobs));

    // Expand job to see steps
    await page.locator('.job-header').first().click();

    const failingStep = page.locator('.step-item.failing');
    await expect(failingStep).toHaveCount(1);
    await expect(failingStep.locator('.step-name')).toHaveText('Build');
  });
});
