(function () {
  const vscode = acquireVsCodeApi();
  let currentData = null;

  const $ = (id) => document.getElementById(id);
  const loadingEl = $('loading');
  const errorEl = $('error');
  const errorMessageEl = $('error-message');
  const retryBtn = $('retry-btn');
  const contentEl = $('content');

  function init() {
    retryBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('refresh-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('open-web-btn').addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    // Route markdown link/image clicks in the README to the host opener.
    $('readme-content').addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && link.href) { e.preventDefault(); vscode.postMessage({ type: 'openInBrowserFromUrl', url: link.href }); }
      if (e.target.tagName === 'IMG' && e.target.src) { vscode.postMessage({ type: 'openInBrowserFromUrl', url: e.target.src }); }
    });
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
  }

  function handleMessage(event) {
    const msg = event.data;
    if (msg.type === 'loading') {
      loadingEl.style.display = msg.show ? 'block' : 'none';
    } else if (msg.type === 'error') {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorMessageEl.textContent = msg.message;
    } else if (msg.type === 'update') {
      currentData = msg.data;
      render(msg.data);
      loadingEl.style.display = 'none';
      errorEl.style.display = 'none';
      contentEl.style.display = 'block';
    } else if (msg.type === 'theme') {
      ForgejoTheme.apply(msg.theme);
    }
  }

  function render(data) {
    // Configure the markdown renderer so relative links in the README resolve
    // against the instance base and are marked data-internal.
    if (data.instanceUrl) ForgejoMarkdown.configure({ instanceUrl: data.instanceUrl });

    const r = data.repo;
    $('repo-name').textContent = r.full_name;
    $('repo-description').textContent = r.description || '';
    const stats = $('repo-stats');
    stats.innerHTML = '';
    stats.appendChild(statBadge('star', r.stars || 0, 'Stars'));
    stats.appendChild(statBadge('repo-forked', r.forks_count || 0, 'Forks'));
    stats.appendChild(statBadge('issue-opened', r.open_issues_count || 0, 'Open issues'));
    if (r.license && r.license.name) stats.appendChild(statBadge('law', r.license.name, 'License'));
    if (r.default_branch) stats.appendChild(statBadge('git-branch', r.default_branch, 'Default branch'));

    renderLanguages(data.languages || {});
    renderFiles(data.topFiles || []);
    renderReadme(data.readmeHtml || '');
    renderLatestRelease(data.latestRelease);
    renderContributors(data.contributors || []);
  }

  function statBadge(iconName, value, label) {
    const span = document.createElement('span');
    span.className = 'stat-badge';
    span.innerHTML = `<span class="stat-icon codicon codicon-${iconName}" aria-hidden="true"></span><span class="stat-value">${ForgejoUtil.escapeHtml(String(value))}</span><span class="stat-label">${ForgejoUtil.escapeHtml(label)}</span>`;
    return span;
  }

  function renderLanguages(languages) {
    const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, e) => sum + e[1], 0);
    const bar = $('languages-bar');
    const list = $('languages-list');
    bar.innerHTML = '';
    list.innerHTML = '';
    if (entries.length === 0 || total === 0) {
      list.textContent = 'No language data';
      return;
    }
    const palette = ['#2da042', '#3794ff', '#8957e5', '#ccac00', '#f14c4c', '#3fb950', '#d2a8ff', '#79c0ff'];
    entries.slice(0, 8).forEach(([name, bytes], idx) => {
      const pct = (bytes / total) * 100;
      const color = palette[idx % palette.length];
      const seg = document.createElement('div');
      seg.className = 'lang-segment';
      seg.style.width = pct + '%';
      seg.style.background = color;
      seg.title = `${name}: ${pct.toFixed(1)}%`;
      bar.appendChild(seg);
      const item = document.createElement('span');
      item.className = 'lang-item';
      item.innerHTML = `<span class="lang-dot" style="background:${color}"></span>${ForgejoUtil.escapeHtml(name)} <span class="lang-pct">${pct.toFixed(1)}%</span>`;
      list.appendChild(item);
    });
  }

  function renderFiles(files) {
    const list = $('files-list');
    list.innerHTML = '';
    if (!files || files.length === 0) {
      list.textContent = 'No files';
      return;
    }
    files.forEach((f) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const iconCls = f.type === 'dir' ? 'folder' : 'file';
      li.innerHTML = `<span class="file-icon codicon codicon-${iconCls}" aria-hidden="true"></span><span class="file-name">${ForgejoUtil.escapeHtml(f.name || f.path)}</span>`;
      li.addEventListener('click', () => {
        if (f.type !== 'dir') vscode.postMessage({ type: 'openFile', path: f.path });
      });
      list.appendChild(li);
    });
  }

  function renderReadme(content) {
    const el = $('readme-content');
    if (!content) {
      el.textContent = 'No README available';
      return;
    }
    el.innerHTML = ForgejoMarkdown.render(content);
  }
  function renderLatestRelease(release) {
    const section = $('release-section');
    const el = $('latest-release');
    if (!release) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    const tagName = release.tag_name || '';
    const name = release.name || tagName;
    const date = release.created_at ? ForgejoUtil.formatTimeAgo(release.created_at) : '';
    el.innerHTML = `<div class="release-teaser">
      <span class="release-tag-pill">${ForgejoUtil.escapeHtml(tagName)}</span>
      <strong>${ForgejoUtil.escapeHtml(name)}</strong>
      <span class="release-date">${ForgejoUtil.escapeHtml(date)}</span>
    </div>`;
    el.querySelector('.release-teaser').addEventListener('click', () => {
      if (release.id) vscode.postMessage({ type: 'openRelease', releaseId: release.id });
    });
  }

  function renderContributors(contributors) {
    const list = $('contributors-list');
    list.innerHTML = '';
    if (!contributors || contributors.length === 0) {
      list.textContent = 'No contributor data';
      return;
    }
    contributors.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'contributor-item';
      const avatar = c.avatar_url ? `<img class="contributor-avatar" src="${ForgejoUtil.escapeHtml(c.avatar_url)}" alt="">` : '<span class="contributor-avatar-placeholder codicon codicon-account" aria-hidden="true"></span>';
      div.innerHTML = `${avatar}<span class="contributor-name">${ForgejoUtil.escapeHtml(c.login)}</span><span class="contributor-count">${c.contributions} commits</span>`;
      div.addEventListener('click', () => vscode.postMessage({ type: 'openContributor', login: c.login }));
      list.appendChild(div);
    });
  }

  init();
})();
