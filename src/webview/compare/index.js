(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  function init() {
    $('retry-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('refresh-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('open-web-btn').addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
  }

  function handleMessage(event) {
    const msg = event.data;
    if (msg.type === 'loading') {
      $('loading').style.display = msg.show ? 'block' : 'none';
    } else if (msg.type === 'error') {
      $('loading').style.display = 'none';
      $('error').style.display = 'block';
      $('error-message').textContent = msg.message;
    } else if (msg.type === 'update') {
      render(msg.data);
      $('loading').style.display = 'none';
      $('error').style.display = 'none';
      $('content').style.display = 'block';
    } else if (msg.type === 'theme') {
      applyTheme(msg.theme);
    }
  }

  function applyTheme(theme) {
    document.body.className = '';
    if (theme === 'light') document.body.classList.add('vscode-light');
    else if (theme === 'dark') document.body.classList.add('vscode-dark');
    else if (theme === 'high-contrast') document.body.classList.add('vscode-high-contrast');
  }

  function render(data) {
    $('compare-title').textContent = `${data.base}...${data.head}`;
    $('commit-count').textContent = String(data.commits.length);
    $('file-count').textContent = String(data.files.length);

    const commitsList = $('commits-list');
    commitsList.innerHTML = '';
    if (data.commits.length === 0) {
      commitsList.innerHTML = '<li class="empty">No commits between these refs</li>';
    } else {
      data.commits.forEach((c) => {
        const li = document.createElement('li');
        li.className = 'commit-row';
        const sha = c.sha.substring(0, 7);
        const date = c.date ? ForgejoUtil.formatTimeAgo(c.date) : '';
        const title = c.message.split('\n')[0];
        li.innerHTML = `<span class="commit-sha">${ForgejoUtil.escapeHtml(sha)}</span>
          <span class="commit-msg">${ForgejoUtil.escapeHtml(title)}</span>
          <span class="commit-meta">${ForgejoUtil.escapeHtml(c.author || '')} \u00b7 ${ForgejoUtil.escapeHtml(date)}</span>`;
        commitsList.appendChild(li);
      });
    }

    const filesList = $('files-list');
    filesList.innerHTML = '';
    let totalAdd = 0, totalDel = 0;
    data.files.forEach((f) => {
      totalAdd += f.additions;
      totalDel += f.deletions;
      const row = document.createElement('div');
      row.className = 'file-row';
      const statusIcon = {
        added: '+', modified: 'M', removed: '-', renamed: 'R', copied: 'C'
      }[f.status] || '?';
      const statusClass = {
        added: 'added', modified: 'modified', removed: 'removed', renamed: 'renamed', copied: 'copied'
      }[f.status] || 'modified';
      row.innerHTML = `<span class="file-status ${statusClass}" title="${ForgejoUtil.escapeHtml(f.status)}">${statusIcon}</span>
        <span class="file-path">${ForgejoUtil.escapeHtml(f.filename)}</span>
        <span class="file-diff-stat"><span class="additions">+${f.additions}</span> <span class="deletions">-${f.deletions}</span></span>`;
      filesList.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'diff-summary';
    summary.innerHTML = `<span class="additions">+${totalAdd}</span> <span class="deletions">-${totalDel}</span> across ${data.files.length} file(s)`;
    filesList.insertBefore(summary, filesList.firstChild);
  }

  init();
})();
