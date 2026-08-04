/*
 * Shared utilities for all Forgejo webviews.
 *
 * Exposed as `window.ForgejoUtil` so each inline script can call:
 *   ForgejoUtil.escapeHtml(text)
 *   ForgejoUtil.formatTimeAgo(dateString)
 *   ForgejoUtil.getContrastColor(hexColor)
 *   ForgejoUtil.formatDuration(startDate, endDate?)
 *   ForgejoUtil.icon(name, extraClass?)   -> codicon span markup
 *
 * Also exposes a `log()` helper that pipes through to the extension's output
 * channel via postMessage (see shared/log.js for the bridge).
 */
(function (global) {
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  /**
   * Render a VS Code codicon span. Names match the codicon vocabulary
   * (e.g. 'git-pull-request', 'check', 'error', 'sync'). Append spin/disabled
   * modifiers via `extraClass` (e.g. 'codicon-modifier-spin'). The codicon font
   * and class sheet are linked into every webview by the base provider.
   */
  function icon(name, extraClass) {
    var cls = 'codicon codicon-' + name;
    if (extraClass) cls += ' ' + extraClass;
    return '<span class="' + cls + '" aria-hidden="true"></span>';
  }

  function getContrastColor(hexColor) {
    var hex = (hexColor || '000000').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16) || 0;
    var g = parseInt(hex.substring(2, 4), 16) || 0;
    var b = parseInt(hex.substring(4, 6), 16) || 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now - date;
    if (isNaN(diffMs)) return '';
    var diffSecs = Math.floor(diffMs / 1000);
    var diffMins = Math.floor(diffSecs / 60);
    var diffHours = Math.floor(diffMins / 60);
    var diffDays = Math.floor(diffHours / 24);
    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 30) return diffDays + 'd ago';
    if (diffDays < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDuration(startDate, endDate) {
    if (!startDate) return '-';
    var start = new Date(startDate);
    var end = endDate ? new Date(endDate) : new Date();
    var diffMs = end - start;
    if (diffMs < 0) return '-';
    var diffSecs = Math.floor(diffMs / 1000);
    var minutes = Math.floor(diffSecs / 60);
    var seconds = diffSecs % 60;
    if (minutes === 0) return seconds + 's';
    if (minutes < 60) return minutes + 'm ' + seconds + 's';
    var hours = Math.floor(minutes / 60);
    var remainingMins = minutes % 60;
    return hours + 'h ' + remainingMins + 'm';
  }

  // Maps a Forgejo/SCM file status to a single uppercase status letter used by
  // compare/review/PR-files. Single source of truth (previously diverged: the
  // compare view used '+/-/M' while review used 'A/M/D').
  var STATUS_LETTERS = {
    added: 'A',
    created: 'A',
    modified: 'M',
    changed: 'M',
    removed: 'D',
    deleted: 'D',
    renamed: 'R',
    copied: 'C'
  };

  function fileStatusGlyph(status) {
    var key = String(status || '').toLowerCase();
    return STATUS_LETTERS[key] || 'M';
  }

  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(n) / Math.log(1024));
    if (i >= units.length) i = units.length - 1;
    var val = n / Math.pow(1024, i);
    return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
  }

  global.ForgejoUtil = {
    escapeHtml: escapeHtml,
    icon: icon,
    getContrastColor: getContrastColor,
    formatTimeAgo: formatTimeAgo,
    formatDuration: formatDuration,
    fileStatusGlyph: fileStatusGlyph,
    formatBytes: formatBytes
  };
})(typeof window !== 'undefined' ? window : this);
