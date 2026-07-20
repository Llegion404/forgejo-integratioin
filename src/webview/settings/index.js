(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  function init() {
    $('retry-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('refresh-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    $('open-web-btn').addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
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

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    $(`tab-${name}`).classList.add('active');
  }

  function render(data) {
    renderBranches(data.branches || []);
    renderProtections(data.protections || []);
    renderCollaborators(data.collaborators || []);
    renderWebhooks(data.webhooks || []);
    renderKeys(data.deployKeys || []);
  }

  function renderBranches(branches) {
    const el = $('tab-branches');
    if (branches.length === 0) { el.innerHTML = '<p class="empty">No branches</p>'; return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Name</th><th>Last commit</th><th>Protected</th></tr></thead><tbody>'
      + branches.map((b) => `<tr><td>${ForgejoUtil.escapeHtml(b.name)}</td><td><code>${ForgejoUtil.escapeHtml((b.commit?.id || '').substring(0, 7))}</code></td><td>${b.protected ? '\u2705' : '\u2014'}</td></tr>`).join('')
      + '</tbody></table>';
  }

  function renderProtections(protections) {
    const el = $('tab-protection');
    if (protections.length === 0) { el.innerHTML = '<p class="empty">No branch protection rules</p>'; return; }
    el.innerHTML = '<ul class="simple-list">' + protections.map((p) => `<li><strong>${ForgejoUtil.escapeHtml(p.rule_name)}</strong> ${p.enable_push === false ? '<span class="badge-warning">push restricted</span>' : ''}</li>`).join('') + '</ul>';
  }

  function renderCollaborators(collaborators) {
    const el = $('tab-collaborators');
    if (collaborators.length === 0) { el.innerHTML = '<p class="empty">No collaborators</p>'; return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>User</th><th>Admin</th><th>Push</th><th>Pull</th></tr></thead><tbody>'
      + collaborators.map((c) => `<tr><td><img class="row-avatar" src="${ForgejoUtil.escapeHtml(c.avatar_url || '')}" alt=""> ${ForgejoUtil.escapeHtml(c.login)}</td><td>${c.permissions?.admin ? '\u2705' : '\u2014'}</td><td>${c.permissions?.push ? '\u2705' : '\u2014'}</td><td>${c.permissions?.pull ? '\u2705' : '\u2014'}</td></tr>`).join('')
      + '</tbody></table>';
  }

  function renderWebhooks(webhooks) {
    const el = $('tab-webhooks');
    if (webhooks.length === 0) { el.innerHTML = '<p class="empty">No webhooks configured</p>'; return; }
    el.innerHTML = '<ul class="simple-list">' + webhooks.map((w) => {
      const url = w.config?.url || w.url || '';
      const events = (w.events || []).join(', ');
      return `<li><strong>${ForgejoUtil.escapeHtml(url)}</strong> <span class="muted">${ForgejoUtil.escapeHtml(events)}</span> ${w.active ? '<span class="badge-success">active</span>' : '<span class="badge-muted">inactive</span>'}</li>`;
    }).join('') + '</ul>';
  }

  function renderKeys(keys) {
    const el = $('tab-keys');
    if (keys.length === 0) { el.innerHTML = '<p class="empty">No deploy keys</p>'; return; }
    el.innerHTML = '<ul class="simple-list">' + keys.map((k) => `<li><strong>${ForgejoUtil.escapeHtml(k.title)}</strong> ${k.read_only ? '<span class="badge-muted">read-only</span>' : '<span class="badge-success">read-write</span>'}<br><code class="key-fingerprint">${ForgejoUtil.escapeHtml(k.key.split('\n')[0].substring(0, 60))}...</code></li>`).join('') + '</ul>';
  }

  init();
})();
