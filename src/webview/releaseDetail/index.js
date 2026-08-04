(function () {
  const vscode = acquireVsCodeApi();
  let currentData = null;

  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const releaseTitle = document.getElementById('release-title');
  const releaseStatusBadge = document.getElementById('release-status-badge');
  const authorName = document.getElementById('author-name');
  const releaseDate = document.getElementById('release-date');
  const releaseTag = document.getElementById('release-tag');
  const releaseBody = document.getElementById('release-body');
  const assetsSection = document.getElementById('assets-section');
  const assetsList = document.getElementById('assets-list');

  const refreshBtn = document.getElementById('refresh-btn');
  const openWebBtn = document.getElementById('open-web-btn');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const copyTagBtn = document.getElementById('copy-tag-btn');

  function init() {
    setupEventListeners();
    setupMessageHandler();
    vscode.postMessage({ type: 'ready' });
  }

  function setupEventListeners() {
    retryBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    openWebBtn.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    copyTagBtn.addEventListener('click', () => vscode.postMessage({ type: 'copyTag' }));
    copyUrlBtn.addEventListener('click', () => {
      if (currentData && currentData.release && currentData.release.html_url) {
        navigator.clipboard.writeText(currentData.release.html_url);
        copyUrlBtn.innerHTML = '<span class="codicon codicon-check" aria-hidden="true"></span>';
        setTimeout(() => { copyUrlBtn.innerHTML = '<span class="codicon codicon-link" aria-hidden="true"></span>'; }, 2000);
      }
    });

    const editBtn = document.getElementById('edit-btn');
    const editDialog = document.getElementById('edit-dialog');
    const editName = document.getElementById('edit-name');
    const editBody = document.getElementById('edit-body');
    const confirmEditBtn = document.getElementById('confirm-edit-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const markLatestBtn = document.getElementById('mark-latest-btn');
    const togglePrereleaseBtn = document.getElementById('toggle-prerelease-btn');

    if (editBtn) {
      editBtn.addEventListener('click', () => {
        if (!currentData || !currentData.release) return;
        editName.value = currentData.release.name || '';
        editBody.value = currentData.release.body || '';
        editDialog.style.display = 'flex';
        editName.focus();
      });
    }
    if (confirmEditBtn) {
      confirmEditBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'editRelease', name: editName.value, body: editBody.value });
        confirmEditBtn.disabled = true;
        confirmEditBtn.textContent = 'Saving…';
      });
    }
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', () => { editDialog.style.display = 'none'; });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => vscode.postMessage({ type: 'deleteRelease' }));
    }
    if (markLatestBtn) {
      markLatestBtn.addEventListener('click', () => vscode.postMessage({ type: 'markLatest' }));
    }
    if (togglePrereleaseBtn) {
      togglePrereleaseBtn.addEventListener('click', () => {
        const isPre = currentData && currentData.release && currentData.release.prerelease === true;
        vscode.postMessage({ type: 'togglePrerelease', isPrerelease: !isPre });
      });
    }

    assetsList.addEventListener('click', (e) => {
      var assetItem = e.target.closest('.asset-item');
      if (assetItem && assetItem.dataset.url) {
        vscode.postMessage({ type: 'openAsset', url: assetItem.dataset.url });
      }
    });

    // Author link → open profile (handled by the base provider router)
    authorName.addEventListener('click', (e) => {
      if (authorName.dataset.username) {
        e.preventDefault();
        vscode.postMessage({ type: 'openUserProfile', username: authorName.dataset.username });
      }
    });

    // markdown links/images → open externally
    releaseBody.addEventListener('click', (e) => {
      var link = e.target.closest('a[href]');
      if (link && link.href) { e.preventDefault(); vscode.postMessage({ type: 'openInBrowserFromUrl', url: link.href }); }
      if (e.target.tagName === 'IMG' && e.target.src) { vscode.postMessage({ type: 'openInBrowserFromUrl', url: e.target.src }); }
    });
  }

  function setupMessageHandler() {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          currentData = message.data;
          updateReleaseDetails(currentData);
          break;
        case 'loading':
          setLoading(message.show);
          break;
        case 'error':
          showError(message.message);
          break;
        case 'theme':
          ForgejoTheme.apply(message.theme);
          break;
        case 'actionComplete':
          // re-enable the edit Save button after an edit resolves
          if (message.action === 'editRelease' || !message.action) {
            const confirmEditBtn = document.getElementById('confirm-edit-btn');
            if (confirmEditBtn) { confirmEditBtn.disabled = false; confirmEditBtn.textContent = 'Save'; }
          }
          break;
      }
    });
  }

  function setLoading(show) {
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
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updateReleaseDetails(data) {
    const release = data.release;
    // Configure the markdown renderer so relative links in release notes resolve.
    if (data.instanceUrl) ForgejoMarkdown.configure({ instanceUrl: data.instanceUrl });

    releaseTitle.textContent = release.name || release.tag_name;

    var statusText = release.draft ? 'Draft' : release.prerelease ? 'Pre-release' : 'Release';
    var statusClass = release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'release';
    releaseStatusBadge.textContent = statusText;
    releaseStatusBadge.className = 'status-badge ' + statusClass;

    const authorLogin = release.author ? release.author.login : 'Unknown';
    authorName.textContent = authorLogin;
    authorName.dataset.username = release.author ? release.author.login : '';

    if (release.created_at) {
      releaseDate.textContent = 'released ' + ForgejoUtil.formatTimeAgo(release.created_at);
    }

    releaseTag.innerHTML = '<code>' + ForgejoUtil.escapeHtml(release.tag_name) + '</code>';

    if (release.body) {
      releaseBody.innerHTML = ForgejoMarkdown.render(release.body);
    } else {
      releaseBody.innerHTML = '<p class="release-empty">No release notes.</p>';
    }

    if (release.assets && release.assets.length > 0) {
      assetsSection.style.display = 'block';
      assetsList.innerHTML = release.assets.map(function (asset) {
        var size = ForgejoUtil.formatBytes(asset.size);
        return '<div class="asset-item" data-url="' + ForgejoUtil.escapeHtml(asset.browser_download_url || '') + '">' +
          '<span class="asset-name">' + ForgejoUtil.escapeHtml(asset.name) + '</span>' +
          '<span class="asset-size">' + size + '</span>' +
          '<span class="asset-download-icon codicon codicon-download" title="Download" aria-hidden="true"></span>' +
          '</div>';
      }).join('');
    } else {
      assetsSection.style.display = 'none';
    }

    setLoading(false);
  }

  init();
})();
