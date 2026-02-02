(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const contentEl = document.getElementById('content');
  const prTitleEl = document.getElementById('pr-title');
  const prNumberEl = document.getElementById('pr-number');
  const prStatusBadge = document.getElementById('pr-status-badge');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const baseBranch = document.getElementById('base-branch');
  const headBranch = document.getElementById('head-branch');
  const prDescriptionEl = document.getElementById('pr-description');
  const activityCountEl = document.getElementById('activity-count');
  const activityTimeline = document.getElementById('activity-timeline');
  
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
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
    if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
    if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
    if (diffDays < 30) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  function updatePRDetails(data) {
    const pr = data.pr;
    const activities = data.activities;
    prTitleEl.textContent = pr.title || 'Untitled PR';
    prNumberEl.textContent = '#' + (pr.number || '?');
    let statusText = pr.state || 'open';
    let statusClass = (pr.state || 'open').toLowerCase();
    if (pr.draft) { statusText = 'Draft'; statusClass = 'draft'; }
    else if (pr.merged) { statusText = 'Merged'; statusClass = 'merged'; }
    prStatusBadge.textContent = statusText;
    prStatusBadge.className = 'status-badge ' + statusClass;
    if (pr.user && pr.user.avatar_url) {
      authorAvatar.src = pr.user.avatar_url;
      authorAvatar.style.display = 'inline-block';
    } else {
      authorAvatar.style.display = 'none';
    }
    authorName.textContent = pr.user ? pr.user.login : 'Unknown';
    if (pr.base) baseBranch.textContent = pr.base.ref || 'unknown';
    if (pr.head) headBranch.textContent = pr.head.ref || 'unknown';
    prDescriptionEl.innerHTML = renderMarkdown(pr.body) || '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
    const activityCount = activities ? activities.length : 0;
    activityCountEl.textContent = '(' + activityCount + ' events)';
    if (activities && activities.length > 0) {
      let html = '';
      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        const userAvatar = act.user && act.user.avatar_url ? act.user.avatar_url : '';
        const userLogin = act.user ? act.user.login : 'Unknown';
        const timeAgo = formatTimeAgo(act.created_at || act.submitted_at || act.committed_at);
        html += '<div class="activity-item">';
        html += '<img class="activity-avatar" src="' + userAvatar + '" alt="" onerror="this.style.display=none">';
        html += '<div class="activity-content">';
        html += '<div class="activity-header">';
        html += '<span class="activity-user">' + escapeHtml(userLogin) + '</span>';
        if (act.type === 'comment') {
          html += '<span class="activity-action">commented</span>';
          html += '<span class="activity-time">' + timeAgo + '</span>';
          html += '</div>';
          if (act.body) html += '<div class="activity-body">' + renderMarkdown(act.body) + '</div>';
        } else if (act.type === 'commit') {
          html += '<span class="activity-action">committed</span>';
          html += '<span class="activity-time">' + timeAgo + '</span>';
          html += '</div>';
          if (act.sha) {
            html += '<div class="activity-commit">';
            html += '<span class="activity-commit-sha">' + act.sha.substring(0, 7) + '</span>';
            html += '<span class="activity-commit-message">' + escapeHtml(act.message || 'No commit message') + '</span>';
            html += '</div>';
          }
        } else if (act.type === 'review') {
          const reviewState = act.state ? act.state.toLowerCase().replace(/_/g, ' ') : 'commented';
          html += '<span class="activity-action">reviewed: ' + reviewState + '</span>';
          html += '<span class="activity-time">' + timeAgo + '</span>';
          html += '</div>';
          if (act.body) html += '<div class="activity-body">' + renderMarkdown(act.body) + '</div>';
        } else {
          html += '<span class="activity-event">' + (act.event || 'performed an action') + '</span>';
          html += '<span class="activity-time">' + timeAgo + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      activityTimeline.innerHTML = html;
    } else {
      activityTimeline.innerHTML = '<p style="color:var(--vscode-descriptionForeground);padding:16px;">No activity yet.</p>';
    }
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
  }
  
  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'update') {
      updatePRDetails(msg.data);
    } else if (msg.type === 'loading') {
      if (msg.show) {
        loadingEl.style.display = 'flex';
        contentEl.style.display = 'none';
      } else {
        loadingEl.style.display = 'none';
      }
    } else if (msg.type === 'error') {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'none';
      errorEl.style.display = 'block';
      document.getElementById('error-message').textContent = msg.message;
    }
  });
  
  vscode.postMessage({ type: 'ready' });
})();
