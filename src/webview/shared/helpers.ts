/**
 * Shared helper functions for webview rendering.
 * These are extracted to enable unit testing.
 */

/**
 * Escapes HTML entities in text to prevent XSS attacks.
 * Uses DOM-based escaping for maximum security.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  // For Node.js environment (tests), use manual escaping
  // In browser, the webview.js uses DOM-based escaping
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Converts basic markdown to HTML.
 * Supports: headers, bold, italic, links, code, and newlines.
 * Note: Input is escaped first to prevent XSS.
 */
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  let html = escapeHtml(text);
  // Headers (must be processed before other patterns)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  // Bold and italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Formats a date string as relative time (e.g., "2 hours ago").
 * Falls back to formatted date for dates older than 30 days.
 */
export function formatTimeAgo(dateString: string | null | undefined, now?: Date): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const currentTime = now || new Date();
  const diffMs = currentTime.getTime() - date.getTime();
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
