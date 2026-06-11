(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;

  console.log('[Forgejo Release Webview] Script loaded');

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
    isReady = true;
  }

  function setupEventListeners() {
    retryBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    openWebBtn.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    copyTagBtn.addEventListener('click', () => vscode.postMessage({ type: 'copyTag' }));
    copyUrlBtn.addEventListener('click', () => {
      if (currentData && currentData.release && currentData.release.html_url) {
        navigator.clipboard.writeText(currentData.release.html_url);
        copyUrlBtn.textContent = '\u2713';
        setTimeout(() => { copyUrlBtn.textContent = '\u{1F4CB}'; }, 2000);
      }
    });

    assetsList.addEventListener('click', (e) => {
      var assetItem = e.target.closest('.asset-item');
      if (assetItem && assetItem.dataset.url) {
        vscode.postMessage({ type: 'openAsset', url: assetItem.dataset.url });
      }
    });

    document.addEventListener('click', (e) => {
      var userLink = e.target.closest('.user-link');
      if (userLink && userLink.dataset.username) {
        e.preventDefault();
      }
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
          applyTheme(message.theme);
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
    const { release, owner, repo } = data;

    releaseTitle.textContent = release.name || release.tag_name;

    var statusText = release.draft ? 'Draft' : release.prerelease ? 'Pre-release' : 'Release';
    var statusClass = release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'release';
    releaseStatusBadge.textContent = statusText;
    releaseStatusBadge.className = 'status-badge ' + statusClass;

    authorName.textContent = release.author ? release.author.login : 'Unknown';

    if (release.created_at) {
      releaseDate.textContent = 'released ' + formatTimeAgo(release.created_at);
    }

    releaseTag.innerHTML = '<code>' + escapeHtml(release.tag_name) + '</code>';

    if (release.body) {
      releaseBody.innerHTML = renderMarkdown(release.body);
    } else {
      releaseBody.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">No release notes.</p>';
    }

    if (release.assets && release.assets.length > 0) {
      assetsSection.style.display = 'block';
      assetsList.innerHTML = release.assets.map(function(asset) {
        var size = formatFileSize(asset.size);
        return '<div class="asset-item" data-url="' + escapeHtml(asset.browser_download_url || '') + '">' +
          '<span class="asset-name">' + escapeHtml(asset.name) + '</span>' +
          '<span class="asset-size">' + size + '</span>' +
          '<span class="asset-download-icon" title="Download">&#x2B07;</span>' +
        '</div>';
      }).join('');
    } else {
      assetsSection.style.display = 'none';
    }

    setLoading(false);
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now - date;
    var diffSecs = Math.floor(diffMs / 1000);
    var diffMins = Math.floor(diffSecs / 60);
    var diffHours = Math.floor(diffMins / 60);
    var diffDays = Math.floor(diffHours / 24);
    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
    if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
    if (diffDays < 30) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    var html = escapeHtml(text);
    var codeBlocks = [];
    html = html.replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g, function(_match, lang, code) {
      var langAttr = lang ? ' class="language-' + lang + '"' : '';
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code' + langAttr + '>' + code + '</code></pre>');
      return '\\n%%CODEBLOCK_' + idx + '%%\\n';
    });
    var inlineCodes = [];
    html = html.replace(/\`([^\\x60\\n]+)\`/g, function(_match, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code>' + code + '</code>');
      return '%%INLINECODE_' + idx + '%%';
    });
    var lines = html.split('\\n');
    var result = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim().match(/^%%CODEBLOCK_\\d+%%$/)) {
        result.push(line.trim());
        continue;
      }
      if (line.match(/^#{1,6}\\s/)) {
        var level = line.match(/^(#{1,6})/)[1].length;
        result.push('<h' + level + '>' + line.substring(level + 1) + '</h' + level + '>');
      } else if (line.match(/^\\s*[-*+]\\s/)) {
        result.push('<li>' + line.replace(/^\\s*[-*+]\\s/, '') + '</li>');
      } else if (line.match(/^\\s*\\d+\\.\\s/)) {
        result.push('<li>' + line.replace(/^\\s*\\d+\\.\\s/, '') + '</li>');
      } else if (line.match(/^>\\s/)) {
        result.push('<blockquote>' + line.substring(2) + '</blockquote>');
      } else if (line.match(/^---+$/)) {
        result.push('<hr>');
      } else if (line.match(/\\*\\*(.+)\\*\\*/)) {
        result.push('<p>' + line.replace(/\\*\\*(.+)\\*\\*/g, '<strong>$1</strong>') + '</p>');
      } else if (line.trim() === '') {
        result.push('');
      } else {
        result.push('<p>' + line + '</p>');
      }
    }
    html = result.join('\\n');
    for (var j = 0; j < codeBlocks.length; j++) {
      html = html.replace('%%CODEBLOCK_' + j + '%%', codeBlocks[j]);
    }
    for (var k = 0; k < inlineCodes.length; k++) {
      html = html.replace('%%INLINECODE_' + k + '%%', inlineCodes[k]);
    }
    return html;
  }

  function applyTheme(theme) {
    document.body.className = 'theme-' + theme;
  }

  init();
})();
