(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;

  console.log('[Forgejo Webview] Script loaded');

  // DOM Elements
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const prTitleEl = document.getElementById('pr-title');
  const prNumberEl = document.getElementById('pr-number');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const prStatusBadge = document.getElementById('pr-status-badge');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const baseBranch = document.getElementById('base-branch');
  const headBranch = document.getElementById('head-branch');

  const checkoutBtn = document.getElementById('checkout-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const openWebBtn = document.getElementById('open-web-btn');
  const addCommentBtn = document.getElementById('add-comment-btn');
  const mergeActionsEl = document.getElementById('merge-actions');
  const mergeBtn = document.getElementById('merge-btn');
  const revertActionsEl = document.getElementById('revert-actions');
  const revertBtn = document.getElementById('revert-btn');

  const prDescriptionEl = document.getElementById('pr-description');
  const ciSection = document.getElementById('ci-section');
  const ciStatusList = document.getElementById('ci-status-list');
  const activityCountEl = document.getElementById('activity-count');
  const activityTimeline = document.getElementById('activity-timeline');

  const commentInputContainer = document.getElementById('comment-input-container');
  const commentInput = document.getElementById('comment-input');
  const submitCommentBtn = document.getElementById('submit-comment-btn');
  const cancelCommentBtn = document.getElementById('cancel-comment-btn');

  const reviewDialog = document.getElementById('review-dialog');
  const reviewState = document.getElementById('review-state');
  const reviewBody = document.getElementById('review-body');
  const submitReviewBtn = document.getElementById('submit-review-btn');
  const cancelReviewBtn = document.getElementById('cancel-review-btn');

  const mergeDialog = document.getElementById('merge-dialog');
  const mergeStrategy = document.getElementById('merge-strategy');
  const mergeMessage = document.getElementById('merge-message');
  const confirmMergeBtn = document.getElementById('confirm-merge-btn');
  const cancelMergeBtn = document.getElementById('cancel-merge-btn');

  // Initialize
  function init() {
    console.log('[Forgejo Webview] Initializing...');
    setupEventListeners();
    setupMessageHandler();
    
    // Notify extension that webview is ready
    console.log('[Forgejo Webview] Posting ready message');
    vscode.postMessage({ type: 'ready' });
    isReady = true;
  }

  function setupEventListeners() {
    console.log('[Forgejo Webview] Setting up event listeners');
    
    retryBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Retry clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    copyUrlBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Copy URL clicked');
      if (currentData && currentData.pr && currentData.pr.html_url) {
        navigator.clipboard.writeText(currentData.pr.html_url);
        copyUrlBtn.textContent = '✓';
        setTimeout(() => {
          copyUrlBtn.textContent = '📋';
        }, 2000);
      }
    });

    checkoutBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Checkout clicked');
      vscode.postMessage({ type: 'checkout' });
    });

    refreshBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Refresh clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    openWebBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Open in web clicked');
      vscode.postMessage({ type: 'openInBrowser' });
    });

    addCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Add comment clicked');
      commentInputContainer.style.display = 'block';
      commentInput.focus();
    });

    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        console.log('[Forgejo Webview] Merge clicked');
        mergeDialog.style.display = 'block';
      });
    }

    if (revertBtn) {
      revertBtn.addEventListener('click', () => {
        console.log('[Forgejo Webview] Revert clicked');
        if (currentData && currentData.pr && currentData.pr.merge_commit_sha) {
          vscode.postMessage({ type: 'revert', commitSha: currentData.pr.merge_commit_sha });
        }
      });
    }

    submitCommentBtn.addEventListener('click', () => {
      const body = commentInput.value.trim();
      console.log('[Forgejo Webview] Submit comment clicked, body length:', body.length);
      if (body) {
        vscode.postMessage({ type: 'addComment', body });
        commentInput.value = '';
        commentInputContainer.style.display = 'none';
      }
    });

    cancelCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel comment clicked');
      commentInput.value = '';
      commentInputContainer.style.display = 'none';
    });

    submitReviewBtn.addEventListener('click', () => {
      const state = reviewState.value;
      const body = reviewBody.value.trim();
      console.log('[Forgejo Webview] Submit review clicked, state:', state);
      vscode.postMessage({ type: 'addReview', state, body });
      reviewBody.value = '';
      reviewDialog.style.display = 'none';
    });

    cancelReviewBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel review clicked');
      reviewBody.value = '';
      reviewDialog.style.display = 'none';
    });

    confirmMergeBtn.addEventListener('click', () => {
      const strategy = mergeStrategy.value;
      const message = mergeMessage.value.trim() || undefined;
      console.log('[Forgejo Webview] Confirm merge clicked, strategy:', strategy);
      vscode.postMessage({ type: 'merge', strategy, message });
      mergeMessage.value = '';
      mergeDialog.style.display = 'none';
    });

    cancelMergeBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel merge clicked');
      mergeMessage.value = '';
      mergeDialog.style.display = 'none';
    });
  }

  function setupMessageHandler() {
    console.log('[Forgejo Webview] Setting up message handler');
    
    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Forgejo Webview] Received message:', message.type);

      switch (message.type) {
        case 'update':
          console.log('[Forgejo Webview] Update received, PR:', message.data?.pr?.title);
          currentData = message.data;
          updatePRDetails(currentData);
          break;
        case 'loading':
          console.log('[Forgejo Webview] Loading state:', message.show);
          setLoading(message.show);
          break;
        case 'error':
          console.log('[Forgejo Webview] Error received:', message.message);
          showError(message.message);
          break;
        case 'theme':
          console.log('[Forgejo Webview] Theme received:', message.theme);
          applyTheme(message.theme);
          break;
        default:
          console.log('[Forgejo Webview] Unknown message type:', message.type);
      }
    });
  }

  function setLoading(show) {
    console.log('[Forgejo Webview] setLoading:', show);
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
    console.log('[Forgejo Webview] showError:', message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updatePRDetails(data) {
    console.log('[Forgejo Webview] Updating PR details');
    const { pr, activities, statuses, owner, repo } = data;

    // Update header
    prTitleEl.textContent = pr.title || 'Untitled PR';
    prNumberEl.textContent = `#${pr.number || '?'}`;

    // Update status badge
    let statusText = pr.state || 'open';
    let statusClass = (pr.state || 'open').toLowerCase();
    
    if (pr.draft) {
      statusText = 'Draft';
      statusClass = 'draft';
    } else if (pr.merged) {
      statusText = 'Merged';
      statusClass = 'merged';
    }
    
    prStatusBadge.textContent = statusText;
    prStatusBadge.className = 'status-badge ' + statusClass;

    // Update author
    if (pr.user && pr.user.avatar_url) {
      authorAvatar.src = pr.user.avatar_url;
      authorAvatar.style.display = 'inline-block';
    } else {
      authorAvatar.style.display = 'none';
    }
    authorName.textContent = pr.user ? pr.user.login : 'Unknown';

    // Update branches
    if (pr.base) {
      baseBranch.textContent = pr.base.ref || 'unknown';
    }
    if (pr.head) {
      headBranch.textContent = pr.head.ref || 'unknown';
    }

    // Update description
    prDescriptionEl.textContent = pr.body || 'No description provided.';

    // Update CI status
    if (statuses && statuses.length > 0) {
      console.log('[Forgejo Webview] CI statuses:', statuses.length);
      ciSection.style.display = 'block';
      ciSection.classList.add('active');
      ciStatusList.innerHTML = statuses.map(status => {
        const statusClass = status.status || 'pending';
        const statusIcon = statusIconForStatus(statusClass);
        const timeAgo = formatTimeAgo(status.updated_at || status.created_at);
        return `
          <div class="ci-status-item ${statusClass}">
            <span class="ci-status-icon">${statusIcon}</span>
            <span class="ci-status-context">${escapeHtml(status.context || 'Unknown')}</span>
            <span class="ci-status-description">${escapeHtml(status.description || '')}</span>
            <span class="ci-status-time">${timeAgo}</span>
          </div>
        `;
      }).join('');
    } else {
      console.log('[Forgejo Webview] No CI statuses');
      ciSection.style.display = 'none';
      ciSection.classList.remove('active');
    }

    // Update action buttons
    console.log('[Forgejo Webview] PR state:', pr.state, 'draft:', pr.draft, 'merged:', pr.merged);
    if (pr.state === 'open' && !pr.draft) {
      mergeActionsEl.style.display = 'flex';
      revertActionsEl.style.display = 'none';
    } else if (pr.merged) {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'flex';
    } else {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'none';
    }

    // Update activity timeline
    const activityCount = activities ? activities.length : 0;
    console.log('[Forgejo Webview] Activities:', activityCount);
    activityCountEl.textContent = `(${activityCount} events)`;
    
    if (activities && activities.length > 0) {
      activityTimeline.innerHTML = activities.map(activity => renderActivity(activity, owner, repo)).join('');
    } else {
      activityTimeline.innerHTML = '<p style="color: var(--vscode-descriptionForeground); padding: 16px;">No activity yet.</p>';
    }

    // Show content
    setLoading(false);
    console.log('[Forgejo Webview] PR details updated successfully');
  }

  function renderActivity(activity, owner, repo) {
    const timeAgo = formatTimeAgo(activity.created_at || activity.submitted_at || activity.committed_at);
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

    if (activity.type === 'review') {
      const reviewClass = activity.state === 'APPROVED' ? 'approved' :
                         activity.state === 'REQUEST_CHANGES' ? 'changes_requested' : 'commented';
      const reviewState = activity.state ? activity.state.toLowerCase().replace(/_/g, ' ') : 'commented';
      return `
        <div class="activity-item activity-review ${reviewClass}">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">reviewed: ${reviewState}</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${activity.body ? `<div class="activity-body">${escapeHtml(activity.body)}</div>` : ''}
          </div>
        </div>
      `;
    }

    if (activity.type === 'commit') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">committed</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${activity.sha ? `
              <div class="activity-commit">
                <span class="activity-commit-sha">${escapeHtml(activity.sha.substring(0, 7))}</span>
                <span class="activity-commit-message">${escapeHtml(activity.message || 'No commit message')}</span>
              </div>
            ` : ''}
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
      'closed': 'closed this pull request',
      'merged': 'merged this pull request',
      'reopened': 'reopened this pull request',
      'reviewed': 'submitted a review',
      'approved': 'approved this pull request',
      'rejected': 'requested changes',
      'commented': 'commented',
      'labeled': 'added a label',
      'unlabeled': 'removed a label',
      'milestoned': 'added to a milestone',
      'demilestoned': 'removed from a milestone',
      'referenced': 'referenced this pull request',
      'assigned': 'was assigned',
      'unassigned': 'was unassigned',
      'locked': 'locked this pull request',
      'unlocked': 'unlocked this pull request',
      'pinned': 'pinned this pull request',
      'unpinned': 'unpinned this pull request',
      'head_ref_deleted': 'deleted the head branch',
      'head_ref_restored': 'restored the head branch',
      'marked_ready_for_review': 'marked as ready for review',
      'converted_to_draft': 'converted to draft'
    };

    return events[activity.event] || activity.event;
  }

  function statusIconForStatus(status) {
    const icons = {
      'pending': '⏳',
      'success': '✅',
      'error': '❌',
      'failure': '❌',
      'warning': '⚠️'
    };
    return icons[status] || icons['pending'];
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

  function applyTheme(theme) {
    console.log('[Forgejo Webview] Applying theme:', theme);
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
  console.log('[Forgejo Webview] Starting initialization');
  init();
})();
