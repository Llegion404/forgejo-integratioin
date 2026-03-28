(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;

  console.log('[Forgejo Action Webview] Script loaded');

  // DOM Elements
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const healthBadge = document.getElementById('health-badge');
  const healthStats = document.getElementById('health-stats');
  const actionName = document.getElementById('action-name');
  const runNumber = document.getElementById('run-number');
  const commitInfo = document.getElementById('commit-info');
  const branchName = document.getElementById('branch-name');
  const eventType = document.getElementById('event-type');
  const durationEl = document.getElementById('duration');

  const refreshBtn = document.getElementById('refresh-btn');
  const rerunBtn = document.getElementById('rerun-btn');
  const openWebBtn = document.getElementById('open-web-btn');

  const jobsCount = document.getElementById('jobs-count');
  const jobsList = document.getElementById('jobs-list');
  const failuresSection = document.getElementById('failures-section');
  const failuresList = document.getElementById('failures-list');

  // Initialize
  function init() {
    console.log('[Forgejo Action Webview] Initializing...');
    setupEventListeners();
    setupMessageHandler();

    // Notify extension that webview is ready
    console.log('[Forgejo Action Webview] Posting ready message');
    vscode.postMessage({ type: 'ready' });
    isReady = true;
  }

  function setupEventListeners() {
    console.log('[Forgejo Action Webview] Setting up event listeners');

    retryBtn.addEventListener('click', () => {
      console.log('[Forgejo Action Webview] Retry clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    refreshBtn.addEventListener('click', () => {
      console.log('[Forgejo Action Webview] Refresh clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    rerunBtn.addEventListener('click', () => {
      console.log('[Forgejo Action Webview] Re-run clicked');
      vscode.postMessage({ type: 'rerun' });
    });

    openWebBtn.addEventListener('click', () => {
      console.log('[Forgejo Action Webview] Open in Browser clicked');
      vscode.postMessage({ type: 'openInBrowser' });
    });
  }

  function setupMessageHandler() {
    console.log('[Forgejo Action Webview] Setting up message handler');

    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Forgejo Action Webview] Received message:', message.type);

      switch (message.type) {
        case 'update':
          console.log('[Forgejo Action Webview] Update received, run:', message.data?.run?.name);
          currentData = message.data;
          updateActionDetails(currentData);
          break;
        case 'loading':
          console.log('[Forgejo Action Webview] Loading state:', message.show);
          setLoading(message.show);
          break;
        case 'error':
          console.log('[Forgejo Action Webview] Error received:', message.message);
          showError(message.message);
          break;
        case 'theme':
          console.log('[Forgejo Action Webview] Theme received:', message.theme);
          applyTheme(message.theme);
          break;
        default:
          console.log('[Forgejo Action Webview] Unknown message type:', message.type);
      }
    });
  }

  function setLoading(show) {
    console.log('[Forgejo Action Webview] setLoading:', show);
    if (show) {
      loadingEl.style.display = 'flex';
      contentEl.style.display = 'none';
      errorEl.style.display = 'none';
    } else {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
      errorEl.style.display = 'none';
    }
  }

  function showError(message) {
    console.log('[Forgejo Action Webview] showError:', message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updateActionDetails(data) {
    console.log('[Forgejo Action Webview] Updating action details');
    const { run, jobs, owner, repo } = data;

    // Update health summary
    const overallStatus = getOverallStatus(run, jobs);
    healthBadge.textContent = overallStatus.text;
    healthBadge.className = 'health-badge ' + overallStatus.status;
    healthStats.textContent = getHealthStats(jobs);

    // Update header
    actionName.textContent = run.name || 'Unnamed Workflow';
    runNumber.textContent = `#${run.run_number || '?'}`;

    // Update commit info
    const shortSha = run.head_sha ? run.head_sha.substring(0, 7) : '?';
    commitInfo.textContent = `${shortSha} - ${run.display_title || 'No commit message'}`;

    // Update branch
    branchName.textContent = run.head_branch || 'unknown';

    // Update event type
    eventType.textContent = formatEventType(run.event);

    // Update duration
    durationEl.textContent = formatDuration(run.started_at || run.run_started_at, run.stopped_at);

    // Render jobs list
    renderJobsList(jobs);

    // Render failures summary
    renderFailures(jobs);

    // Show content
    setLoading(false);
    console.log('[Forgejo Action Webview] Action details updated successfully');
  }

  function getOverallStatus(run, jobs) {
    const status = run.status;

    // Forgejo uses status directly (success, failure, cancelled)
    switch (status) {
      case 'success':
        return { status: 'success', text: 'SUCCESS' };
      case 'failure':
        return { status: 'failure', text: 'FAILURE' };
      case 'in_progress':
        return { status: 'running', text: 'RUNNING' };
      case 'queued':
        return { status: 'queued', text: 'QUEUED' };
      case 'waiting':
        return { status: 'waiting', text: 'WAITING' };
      case 'cancelled':
        return { status: 'cancelled', text: 'CANCELLED' };
      case 'skipped':
        return { status: 'skipped', text: 'SKIPPED' };
      default:
        return { status: 'running', text: status ? status.toUpperCase() : 'UNKNOWN' };
    }
  }

  function getHealthStats(jobs) {
    if (!jobs || jobs.length === 0) {
      return 'No jobs';
    }

    const passed = jobs.filter(j => j.status === 'success').length;
    const failed = jobs.filter(j => j.status === 'failure').length;
    const total = jobs.length;

    let stats = `${passed} of ${total} jobs passed`;
    if (failed > 0) {
      stats += ` \u2022 ${failed} failed`;
    }
    return stats;
  }

  function renderJobsList(jobs) {
    if (!jobs || jobs.length === 0) {
      jobsCount.textContent = '(0)';
      jobsList.innerHTML = '<p style="color: var(--vscode-descriptionForeground); padding: 16px;">No jobs found.</p>';
      return;
    }

    jobsCount.textContent = `(${jobs.length})`;

    jobsList.innerHTML = jobs.map((job, index) => {
      const statusIcon = getStatusIcon(job.status);
      const duration = formatDuration(job.started_at, job.completed_at);
      const hasSteps = job.steps && job.steps.length > 0;

      return `
        <div class="job-item" data-job-index="${index}">
          <div class="job-header ${job.status}" onclick="toggleJob(${index})">
            <span class="job-status-icon">${statusIcon}</span>
            <span class="job-name">${escapeHtml(job.name)}</span>
            <span class="job-duration">${duration}</span>
            ${hasSteps ? '<span class="job-expand-icon">\u25BC</span>' : ''}
          </div>
          ${hasSteps ? renderStepsList(job.steps, index) : ''}
        </div>
      `;
    }).join('');
  }

  function renderStepsList(steps, jobIndex) {
    if (!steps || steps.length === 0) {
      return '';
    }

    return `
      <div class="steps-list" id="steps-${jobIndex}">
        ${steps.map(step => {
          const statusIcon = getStatusIcon(step.status);
          const duration = formatDuration(step.started_at, step.completed_at);
          const isFailing = step.status === 'failure';

          return `
            <div class="step-item ${isFailing ? 'failing' : ''}">
              <span class="step-number">${step.number}</span>
              <span class="step-status-icon">${statusIcon}</span>
              <span class="step-name">${escapeHtml(step.name)}</span>
              <span class="step-duration">${duration}</span>
            </div>
          `;
        }).join('')}
        <div class="step-item" style="justify-content: flex-end;">
          <button class="view-logs-btn" onclick="viewLogs(${jobIndex})">View Logs</button>
        </div>
      </div>
    `;
  }

  function renderFailures(jobs) {
    const failures = [];

    if (jobs) {
      jobs.forEach(job => {
        if (job.steps) {
          job.steps.forEach(step => {
            if (step.status === 'failure') {
              failures.push({ jobName: job.name, stepName: step.name });
            }
          });
        }
      });
    }

    if (failures.length === 0) {
      failuresSection.style.display = 'none';
      return;
    }

    failuresSection.style.display = 'block';
    failuresList.innerHTML = failures.map(f => `
      <div class="failure-item">
        <span class="failure-job-name">${escapeHtml(f.jobName)}</span>
        <span class="failure-separator">\u2192</span>
        <span class="failure-step-name">${escapeHtml(f.stepName)}</span>
      </div>
    `).join('');
  }

  function getStatusIcon(status) {
    // Forgejo uses status directly (success, failure, cancelled)
    switch (status) {
      case 'success':
        return '\u2705'; // Green check
      case 'failure':
        return '\u274C'; // Red X
      case 'in_progress':
      case 'queued':
      case 'waiting':
        return '\u23F3'; // Hourglass
      case 'cancelled':
        return '\u26D4'; // No entry
      case 'skipped':
        return '\u23ED'; // Skip forward
      default:
        return '\u2B58'; // Circle outline
    }
  }

  function formatEventType(event) {
    if (!event) return 'unknown';

    const eventNames = {
      'push': 'push',
      'pull_request': 'pull request',
      'pull_request_target': 'pull request',
      'schedule': 'schedule',
      'workflow_dispatch': 'manual',
      'repository_dispatch': 'dispatch',
      'release': 'release',
      'create': 'create',
      'delete': 'delete',
      'fork': 'fork',
      'issues': 'issue',
      'issue_comment': 'comment',
      'watch': 'star'
    };

    return eventNames[event] || event;
  }

  function formatDuration(startDate, endDate) {
    if (!startDate) return '-';

    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();

    const diffMs = end - start;
    if (diffMs < 0) return '-';

    const diffSecs = Math.floor(diffMs / 1000);
    const minutes = Math.floor(diffSecs / 60);
    const seconds = diffSecs % 60;

    if (minutes === 0) {
      return `${seconds}s`;
    } else if (minutes < 60) {
      return `${minutes}m ${seconds}s`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return `${hours}h ${remainingMins}m`;
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function applyTheme(theme) {
    console.log('[Forgejo Action Webview] Applying theme:', theme);
    document.body.className = '';
    if (theme === 'light') {
      document.body.classList.add('vscode-light');
    } else if (theme === 'dark') {
      document.body.classList.add('vscode-dark');
    } else if (theme === 'high-contrast') {
      document.body.classList.add('vscode-high-contrast');
    }
  }

  // Global functions for onclick handlers
  window.toggleJob = function(jobIndex) {
    const jobItem = document.querySelector(`.job-item[data-job-index="${jobIndex}"]`);
    if (jobItem) {
      jobItem.classList.toggle('expanded');
    }
  };

  window.viewLogs = function(jobIndex) {
    const job = currentData && currentData.jobs ? currentData.jobs[jobIndex] : null;
    console.log('[Forgejo Action Webview] View logs clicked for job:', jobIndex, job && job.id);
    if (!job) {
      vscode.postMessage({ type: 'refresh' });
      return;
    }
    vscode.postMessage({
      type: 'viewLogs',
      jobRef: {
        jobId: job.id,
        jobHtmlUrl: job.html_url,
        jobIndex: jobIndex
      }
    });
  };

  // Start
  console.log('[Forgejo Action Webview] Starting initialization');
  init();
})();
