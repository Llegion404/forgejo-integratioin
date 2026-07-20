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
    const r = data.repo;
    $('repo-name').textContent = r.full_name;
    $('repo-description').textContent = r.description || '';
    const stats = $('repo-stats');
    stats.innerHTML = '';
    stats.appendChild(statBadge('\u2B50', r.stars || 0, 'Stars'));
    stats.appendChild(statBadge('\u{1F4E4}', r.forks_count || 0, 'Forks'));
    stats.appendChild(statBadge('\u26A0', r.open_issues_count || 0, 'Open issues'));
    if (r.license && r.license.name) stats.appendChild(statBadge('\u{1F4D6}', r.license.name, 'License'));
    if (r.default_branch) stats.appendChild(statBadge('\u{1F33F}', r.default_branch, 'Default branch'));

    renderLanguages(data.languages || {});
    renderFiles(data.topFiles || []);
    renderReadme(data.readmeHtml || '');
    renderLatestRelease(data.latestRelease, data);
    renderContributors(data.contributors || []);
  }

  function statBadge(icon, value, label) {
    const span = document.createElement('span');
    span.className = 'stat-badge';
    span.innerHTML = `<span class="stat-icon">${icon}</span><span class="stat-value">${ForgejoUtil.escapeHtml(String(value))}</span><span class="stat-label">${ForgejoUtil.escapeHtml(label)}</span>`;
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
      li.innerHTML = `<span class="file-icon">${f.type === 'dir' ? '\u{1F4C1}' : '\u{1F4C4}'}</span><span class="file-name">${ForgejoUtil.escapeHtml(f.name || f.path)}</span>`;
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
      const avatar = c.avatar_url ? `<img class="contributor-avatar" src="${ForgejoUtil.escapeHtml(c.avatar_url)}" alt="">` : '<span class="contributor-avatar-placeholder">\u{1F464}</span>';
      div.innerHTML = `${avatar}<span class="contributor-name">${ForgejoUtil.escapeHtml(c.login)}</span><span class="contributor-count">${c.contributions} commits</span>`;
      div.addEventListener('click', () => vscode.postMessage({ type: 'openContributor', login: c.login }));
      list.appendChild(div);
    });
  }

  init();
})();
