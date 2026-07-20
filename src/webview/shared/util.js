/*
 * Shared utilities for all Forgejo webviews.
 *
 * Exposed as `window.ForgejoUtil` so each inline script can call:
 *   ForgejoUtil.escapeHtml(text)
 *   ForgejoUtil.formatTimeAgo(dateString)
 *   ForgejoUtil.getContrastColor(hexColor)
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

  global.ForgejoUtil = {
    escapeHtml: escapeHtml,
    getContrastColor: getContrastColor,
    formatTimeAgo: formatTimeAgo,
    formatDuration: formatDuration
  };
})(typeof window !== 'undefined' ? window : this);
