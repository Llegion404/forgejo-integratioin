(function () {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let pollTimer = null;

  const $ = (id) => document.getElementById(id);
  const loadingEl = $('loading');
  const errorEl = $('error');
  const errorMessageEl = $('error-message');
  const retryBtn = $('retry-btn');
  const contentEl = $('content');

  const healthBadge = $('health-badge');
  const healthStats = $('health-stats');
  const actionName = $('action-name');
  const runNumber = $('run-number');
  const commitInfo = $('commit-info');
  const branchName = $('branch-name');
  const eventType = $('event-type');
  const durationEl = $('duration');

  const refreshBtn = $('refresh-btn');
  const rerunBtn = $('rerun-btn');
  const cancelBtn = $('cancel-btn');
  const openWebBtn = $('open-web-btn');

  const jobsCount = $('jobs-count');
  const jobsList = $('jobs-list');
  const failuresSection = $('failures-section');
  const failuresList = $('failures-list');

  // Statuses that mean the run is still in flight ( Forgejo WorkflowRunStatus
  // has no 'blocked'; keep the set honest).
  const ACTIVE_STATES = ['in_progress', 'queued', 'waiting'];

  function init() {
    retryBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    rerunBtn.addEventListener('click', () => vscode.postMessage({ type: 'rerun' }));
    cancelBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    openWebBtn.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));

    jobsList.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const toggleEl = target.closest('[data-action="toggle-job"]');
      if (toggleEl) {
        const idx = Number(toggleEl.dataset.jobIndex);
        const jobItem = jobsList.querySelector('.job-item[data-job-index="' + String(idx) + '"]');
        if (jobItem) jobItem.classList.toggle('expanded');
        return;
      }

      const viewLogsBtn = target.closest('[data-action="view-logs"]');
      if (viewLogsBtn) {
        const jobIndex = Number(viewLogsBtn.dataset.jobIndex);
        const job = currentData && currentData.jobs ? currentData.jobs[jobIndex] : null;
        if (!job) { vscode.postMessage({ type: 'refresh' }); return; }
        vscode.postMessage({
          type: 'viewLogs',
          jobRef: { jobId: job.id, jobHtmlUrl: job.html_url, jobIndex: jobIndex }
        });
      }
    });

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
  }

  function handleMessage(event) {
    const message = event.data;
    switch (message.type) {
      case 'update':
        currentData = message.data;
        updateActionDetails(currentData);
        break;
      case 'loading': setLoading(message.show); break;
      case 'error': showError(message.message); break;
      case 'theme': ForgejoTheme.apply(message.theme); break;
    }
  }

  function setLoading(show) {
    loadingEl.style.display = show ? 'flex' : 'none';
    contentEl.style.display = show ? 'none' : 'block';
    errorEl.style.display = 'none';
  }

  function showError(message) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updateActionDetails(data) {
    const run = data.run;
    const jobs = data.jobs;

    const overallStatus = getOverallStatus(run);
    healthBadge.textContent = overallStatus.text;
    healthBadge.className = 'health-badge ' + overallStatus.status;
    healthStats.textContent = getHealthStats(jobs);

    actionName.textContent = run.name || 'Unnamed Workflow';
    runNumber.textContent = '#' + (run.run_number || '?');

    const shortSha = run.head_sha ? run.head_sha.substring(0, 7) : '?';
    commitInfo.textContent = shortSha + ' - ' + (run.display_title || 'No commit message');
    branchName.textContent = run.head_branch || 'unknown';
    eventType.textContent = formatEventType(run.event);

    // Honest duration: stopped_at is filled by the provider for terminal runs
    // (proxied from updated_at) and left null while in flight so the timer runs.
    durationEl.textContent = ForgejoUtil.formatDuration(run.started_at || run.run_started_at, run.stopped_at);

    const inFlight = ACTIVE_STATES.indexOf(run.status) !== -1;
    cancelBtn.style.display = inFlight ? 'inline-flex' : 'none';
    rerunBtn.style.display = inFlight ? 'none' : 'inline-flex';

    renderJobsList(jobs);
    renderFailures(jobs);

    // Surface per-section fetch failures (e.g. jobs 403) instead of silently
    // showing "No jobs found".
    const jobsWarningEl = $('jobs-warning');
    if (jobsWarningEl) {
      if (data.jobsWarning) {
        jobsWarningEl.textContent = 'Could not load jobs: ' + data.jobsWarning;
        jobsWarningEl.style.display = 'block';
      } else {
        jobsWarningEl.style.display = 'none';
      }
    }

    setLoading(false);
    scheduleRunPolling(run);
  }

  function scheduleRunPolling(run) {
    stopRunPolling();
    if (!run) return;
    if (ACTIVE_STATES.indexOf(run.status) === -1) return;
    pollTimer = setInterval(() => { vscode.postMessage({ type: 'refresh' }); }, 2000);
  }

  function stopRunPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Prefer `conclusion` (the specific terminal outcome — includes timed_out,
  // neutral, action_required which status alone never surfaces) and fall back
  // to runtime status while the run is still in flight.
  function getOverallStatus(run) {
    switch (run.conclusion) {
      case 'success': return { status: 'success', text: 'SUCCESS' };
      case 'failure': return { status: 'failure', text: 'FAILURE' };
      case 'timed_out': return { status: 'failure', text: 'TIMED OUT' };
      case 'neutral': return { status: 'neutral', text: 'NEUTRAL' };
      case 'action_required': return { status: 'neutral', text: 'ACTION REQUIRED' };
      case 'cancelled': return { status: 'cancelled', text: 'CANCELLED' };
      case 'skipped': return { status: 'skipped', text: 'SKIPPED' };
    }
    switch (run.status) {
      case 'in_progress': return { status: 'running', text: 'RUNNING' };
      case 'queued': return { status: 'queued', text: 'QUEUED' };
      case 'waiting': return { status: 'waiting', text: 'WAITING' };
      case 'success': return { status: 'success', text: 'SUCCESS' };
      case 'failure': return { status: 'failure', text: 'FAILURE' };
      case 'cancelled': return { status: 'cancelled', text: 'CANCELLED' };
      case 'skipped': return { status: 'skipped', text: 'SKIPPED' };
      default: return { status: 'neutral', text: run.status ? run.status.toUpperCase() : 'UNKNOWN' };
    }
  }

  function getHealthStats(jobs) {
    if (!jobs || jobs.length === 0) return 'No jobs';
    const passed = jobs.filter(isJobPassing).length;
    const failed = jobs.filter(isJobFailing).length;
    let stats = passed + ' of ' + jobs.length + ' jobs passed';
    if (failed > 0) stats += ' \u2022 ' + failed + ' failed';
    return stats;
  }

  function isJobFailing(job) {
    return job.conclusion === 'failure' || job.conclusion === 'timed_out' ||
      job.status === 'failure' || job.status === 'timed_out';
  }
  function isJobPassing(job) {
    return job.conclusion === 'success' || job.status === 'success';
  }

  function renderJobsList(jobs) {
    if (!jobs || jobs.length === 0) {
      jobsCount.textContent = '(0)';
      jobsList.innerHTML = '<p class="jobs-empty">No jobs found.</p>';
      return;
    }
    jobsCount.textContent = '(' + jobs.length + ')';
    jobsList.innerHTML = jobs.map(function (job, index) {
      const statusIcon = getStatusIcon(job.status, job.conclusion);
      const duration = ForgejoUtil.formatDuration(job.started_at, job.completed_at);
      const hasSteps = job.steps && job.steps.length > 0;
      return '<div class="job-item" data-job-index="' + index + '">' +
        '<div class="job-header ' + escapeStatus(job.status, job.conclusion) + '" data-action="toggle-job" data-job-index="' + index + '">' +
          '<span class="job-status-icon">' + statusIcon + '</span>' +
          '<span class="job-name">' + ForgejoUtil.escapeHtml(job.name) + '</span>' +
          '<span class="job-duration">' + duration + '</span>' +
          (hasSteps ? '<span class="job-expand-icon codicon codicon-chevron-down" aria-hidden="true"></span>' : '') +
        '</div>' +
        renderStepsList(job.steps, index) +
      '</div>';
    }).join('');
  }

  // Always renders the steps container + View Logs button, even with no steps,
  // so logs remain reachable for step-less jobs.
  function renderStepsList(steps, jobIndex) {
    var stepsHtml = '';
    if (steps && steps.length > 0) {
      stepsHtml = steps.map(function (step) {
        var statusIcon = getStatusIcon(step.status, step.conclusion);
        var duration = ForgejoUtil.formatDuration(step.started_at, step.completed_at);
        var failing = step.conclusion === 'failure' || step.conclusion === 'timed_out' || step.status === 'failure';
        return '<div class="step-item ' + (failing ? 'failing' : '') + '">' +
          '<span class="step-number">' + step.number + '</span>' +
          '<span class="step-status-icon">' + statusIcon + '</span>' +
          '<span class="step-name">' + ForgejoUtil.escapeHtml(step.name) + '</span>' +
          '<span class="step-duration">' + duration + '</span>' +
        '</div>';
      }).join('');
    }
    return '<div class="steps-list" id="steps-' + jobIndex + '">' +
      stepsHtml +
      '<div class="step-item step-logs-row"><button class="view-logs-btn btn btn-sm" data-action="view-logs" data-job-index="' + jobIndex + '">View Logs</button></div>' +
    '</div>';
  }

  function renderFailures(jobs) {
    var failures = [];
    if (jobs) {
      jobs.forEach(function (job) {
        if (job.steps) {
          job.steps.forEach(function (step) {
            if (step.conclusion === 'failure' || step.conclusion === 'timed_out' || step.status === 'failure') {
              failures.push({ jobName: job.name, stepName: step.name });
            }
          });
        }
      });
    }
    if (failures.length === 0) { failuresSection.style.display = 'none'; return; }
    failuresSection.style.display = 'block';
    failuresList.innerHTML = failures.map(function (f) {
      return '<div class="failure-item">' +
        '<span class="failure-job-name">' + ForgejoUtil.escapeHtml(f.jobName) + '</span>' +
        '<span class="failure-separator codicon codicon-arrow-right" aria-hidden="true"></span>' +
        '<span class="failure-step-name">' + ForgejoUtil.escapeHtml(f.stepName) + '</span>' +
      '</div>';
    }).join('');
  }

  function getStatusIcon(status, conclusion) {
    var outcome = conclusion || status;
    switch (outcome) {
      case 'success': return '<span class="codicon codicon-pass" aria-hidden="true"></span>';
      case 'failure':
      case 'timed_out': return '<span class="codicon codicon-error" aria-hidden="true"></span>';
      case 'in_progress':
      case 'queued':
      case 'waiting': return '<span class="codicon codicon-sync codicon-modifier-spin" aria-hidden="true"></span>';
      case 'cancelled': return '<span class="codicon codicon-blocked" aria-hidden="true"></span>';
      case 'skipped': return '<span class="codicon codicon-debug-step-over" aria-hidden="true"></span>';
      case 'neutral':
      case 'action_required': return '<span class="codicon codicon-warning" aria-hidden="true"></span>';
      default: return '<span class="codicon codicon-circle-slash" aria-hidden="true"></span>';
    }
  }

  // Map a (status, conclusion) pair to a CSS class token used by both the
  // health badge and the per-job header colour rules.
  function escapeStatus(status, conclusion) {
    var outcome = conclusion || status;
    if (outcome === 'timed_out' || outcome === 'failure') return 'failure';
    if (outcome === 'success') return 'success';
    if (outcome === 'cancelled') return 'cancelled';
    if (outcome === 'skipped') return 'skipped';
    if (outcome === 'neutral' || outcome === 'action_required') return 'neutral';
    if (outcome === 'in_progress') return 'running';
    if (outcome === 'queued') return 'queued';
    if (outcome === 'waiting') return 'waiting';
    return 'neutral';
  }

  function formatEventType(event) {
    if (!event) return 'unknown';
    var names = {
      'push': 'push', 'pull_request': 'pull request', 'pull_request_target': 'pull request',
      'schedule': 'schedule', 'workflow_dispatch': 'manual', 'repository_dispatch': 'dispatch',
      'release': 'release', 'create': 'create', 'delete': 'delete', 'fork': 'fork',
      'issues': 'issue', 'issue_comment': 'comment', 'watch': 'star'
    };
    return names[event] || event;
  }

  init();
})();
