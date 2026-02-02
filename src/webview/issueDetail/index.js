(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;

  console.log('[Forgejo Issue Webview] Script loaded');

  // DOM Elements
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const issueTitleEl = document.getElementById('issue-title');
  const issueNumberEl = document.getElementById('issue-number');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const issueStatusBadge = document.getElementById('issue-status-badge');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const issueCreated = document.getElementById('issue-created');
  const labelsContainer = document.getElementById('labels-container');
  const assigneesContainer = document.getElementById('assignees-container');

  const refreshBtn = document.getElementById('refresh-btn');
  const openWebBtn = document.getElementById('open-web-btn');
  const addCommentBtn = document.getElementById('add-comment-btn');
  const closeIssueBtn = document.getElementById('close-issue-btn');
  const reopenIssueBtn = document.getElementById('reopen-issue-btn');

  const issueDescriptionEl = document.getElementById('issue-description');
  const activityCountEl = document.getElementById('activity-count');
  const activityTimeline = document.getElementById('activity-timeline');

  const commentInputContainer = document.getElementById('comment-input-container');
  const commentInput = document.getElementById('comment-input');
  const submitCommentBtn = document.getElementById('submit-comment-btn');
  const cancelCommentBtn = document.getElementById('cancel-comment-btn');

  // Initialize
  function init() {
    console.log('[Forgejo Issue Webview] Initializing...');
    setupEventListeners();
    setupMessageHandler();

    // Notify extension that webview is ready
    console.log('[Forgejo Issue Webview] Posting ready message');
    vscode.postMessage({ type: 'ready' });
    isReady = true;
  }

  function setupEventListeners() {
    console.log('[Forgejo Issue Webview] Setting up event listeners');

    retryBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Retry clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    copyUrlBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Copy URL clicked');
      if (currentData && currentData.issue && currentData.issue.html_url) {
        navigator.clipboard.writeText(currentData.issue.html_url);
        copyUrlBtn.textContent = '✓';
        setTimeout(() => {
          copyUrlBtn.textContent = '📋';
        }, 2000);
      }
    });

    refreshBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Refresh clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    openWebBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Open in web clicked');
      vscode.postMessage({ type: 'openInBrowser' });
    });

    addCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Add comment clicked');
      commentInputContainer.style.display = 'block';
      commentInput.focus();
    });

    closeIssueBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Close issue clicked');
      vscode.postMessage({ type: 'closeIssue' });
    });

    reopenIssueBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Reopen issue clicked');
      vscode.postMessage({ type: 'reopenIssue' });
    });

    submitCommentBtn.addEventListener('click', () => {
      const body = commentInput.value.trim();
      console.log('[Forgejo Issue Webview] Submit comment clicked, body length:', body.length);
      if (body) {
        vscode.postMessage({ type: 'addComment', body });
        commentInput.value = '';
        commentInputContainer.style.display = 'none';
      }
    });

    cancelCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Cancel comment clicked');
      commentInput.value = '';
      commentInputContainer.style.display = 'none';
    });
  }

  function setupMessageHandler() {
    console.log('[Forgejo Issue Webview] Setting up message handler');

    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Forgejo Issue Webview] Received message:', message.type);

      switch (message.type) {
        case 'update':
          console.log('[Forgejo Issue Webview] Update received, Issue:', message.data?.issue?.title);
          currentData = message.data;
          updateIssueDetails(currentData);
          break;
        case 'loading':
          console.log('[Forgejo Issue Webview] Loading state:', message.show);
          setLoading(message.show);
          break;
        case 'error':
          console.log('[Forgejo Issue Webview] Error received:', message.message);
          showError(message.message);
          break;
        case 'theme':
          console.log('[Forgejo Issue Webview] Theme received:', message.theme);
          applyTheme(message.theme);
          break;
        default:
          console.log('[Forgejo Issue Webview] Unknown message type:', message.type);
      }
    });
  }

  function setLoading(show) {
    console.log('[Forgejo Issue Webview] setLoading:', show);
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
    console.log('[Forgejo Issue Webview] showError:', message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updateIssueDetails(data) {
    console.log('[Forgejo Issue Webview] Updating Issue details');
    const { issue, activities, owner, repo } = data;

    // Update header
    issueTitleEl.textContent = issue.title || 'Untitled Issue';
    issueNumberEl.textContent = `#${issue.number || '?'}`;

    // Update status badge
    const statusText = issue.state || 'open';
    const statusClass = (issue.state || 'open').toLowerCase();

    issueStatusBadge.textContent = statusText;
    issueStatusBadge.className = 'status-badge ' + statusClass;

    // Update author
    if (issue.user && issue.user.avatar_url) {
      authorAvatar.src = issue.user.avatar_url;
      authorAvatar.style.display = 'inline-block';
    } else {
      authorAvatar.style.display = 'none';
    }
    authorName.textContent = issue.user ? issue.user.login : 'Unknown';

    // Update created date
    if (issue.created_at) {
      issueCreated.textContent = 'opened ' + formatTimeAgo(issue.created_at);
    }

    // Update labels
    if (issue.labels && issue.labels.length > 0) {
      labelsContainer.style.display = 'flex';
      labelsContainer.innerHTML = issue.labels.map(label => {
        const bgColor = label.color ? `#${label.color}` : 'var(--vscode-badge-background)';
        const textColor = getContrastColor(label.color || '000000');
        return `<span class="label" style="background-color: ${bgColor}; color: ${textColor};">${escapeHtml(label.name)}</span>`;
      }).join('');
    } else {
      labelsContainer.style.display = 'none';
    }

    // Update assignees
    if (issue.assignees && issue.assignees.length > 0) {
      assigneesContainer.style.display = 'flex';
      assigneesContainer.innerHTML = '<span class="assignees-label">Assignees:</span> ' +
        issue.assignees.map(a => `<span class="assignee">${escapeHtml(a.login)}</span>`).join(', ');
    } else {
      assigneesContainer.style.display = 'none';
    }

    // Update description
    issueDescriptionEl.textContent = issue.body || 'No description provided.';

    // Update action buttons
    console.log('[Forgejo Issue Webview] Issue state:', issue.state);
    if (issue.state === 'open') {
      closeIssueBtn.style.display = 'inline-flex';
      reopenIssueBtn.style.display = 'none';
    } else {
      closeIssueBtn.style.display = 'none';
      reopenIssueBtn.style.display = 'inline-flex';
    }

    // Update activity timeline
    const activityCount = activities ? activities.length : 0;
    console.log('[Forgejo Issue Webview] Activities:', activityCount);
    activityCountEl.textContent = `(${activityCount} events)`;

    if (activities && activities.length > 0) {
      activityTimeline.innerHTML = activities.map(activity => renderActivity(activity, owner, repo)).join('');
    } else {
      activityTimeline.innerHTML = '<p style="color: var(--vscode-descriptionForeground); padding: 16px;">No activity yet.</p>';
    }

    // Show content
    setLoading(false);
    console.log('[Forgejo Issue Webview] Issue details updated successfully');
  }

  function renderActivity(activity, owner, repo) {
    const timeAgo = formatTimeAgo(activity.created_at);
    const userAvatar = activity.user ? activity.user.avatar_url : '';
    const userLogin = activity.user ? activity.user.login : 'Unknown';

    if (activity.type === 'comment') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">commented</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${activity.body ? `<div class="activity-body">${escapeHtml(activity.body)}</div>` : ''}
          </div>
        </div>
      `;
    }

    if (activity.type === 'timeline') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-event">${renderTimelineEvent(activity)}</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  function renderTimelineEvent(activity) {
    if (!activity.event) return 'performed an action';

    const events = {
      'closed': 'closed this issue',
      'reopened': 'reopened this issue',
      'commented': 'commented',
      'labeled': 'added a label',
      'unlabeled': 'removed a label',
      'milestoned': 'added to a milestone',
      'demilestoned': 'removed from a milestone',
      'referenced': 'referenced this issue',
      'assigned': 'was assigned',
      'unassigned': 'was unassigned',
      'locked': 'locked this issue',
      'unlocked': 'unlocked this issue',
      'pinned': 'pinned this issue',
      'unpinned': 'unpinned this issue',
      'renamed': 'changed the title',
      'change_title': 'changed the title',
      'transferred': 'transferred this issue'
    };

    return events[activity.event] || activity.event;
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffDays < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getContrastColor(hexColor) {
    // Convert hex to RGB
    const r = parseInt(hexColor.substr(0, 2), 16);
    const g = parseInt(hexColor.substr(2, 2), 16);
    const b = parseInt(hexColor.substr(4, 2), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return black or white based on luminance
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  function applyTheme(theme) {
    console.log('[Forgejo Issue Webview] Applying theme:', theme);
    document.body.className = '';
    if (theme === 'light') {
      document.body.classList.add('vscode-light');
    } else if (theme === 'dark') {
      document.body.classList.add('vscode-dark');
    } else if (theme === 'high-contrast') {
      document.body.classList.add('vscode-high-contrast');
    }
  }

  // Start
  console.log('[Forgejo Issue Webview] Starting initialization');
  init();
})();
