/*
 * Bridge for sending webview logs to the extension's output channel.
 *
 * Usage:
 *   window.ForgejoLog.info('message', optionalData);
 *   window.ForgejoLog.warn(...);
 *   window.ForgejoLog.error(...);
 *
 * The extension provider routes these to the existing Logger singleton via the
 * 'log' message type.  Replaces ~50 stray `console.log` calls and ensures
 * logs are visible in production (the webview devtools console is hidden).
 */
(function (global) {
  function post(level, message, data) {
    try {
      var vscode = global.acquireVsCodeApi && global.acquireVsCodeApi();
      if (!vscode || !vscode.postMessage) return;
      vscode.postMessage({ type: 'log', level: level, message: message, data: data });
    } catch (_e) {
      // acquireVsCodeApi only available in webview context
    }
  }

  function info(message, data) { post('info', message, data); }
  function warn(message, data) { post('warn', message, data); }
  function error(message, data) { post('error', message, data); }
  function debug(message, data) { post('debug', message, data); }

  global.ForgejoLog = { info: info, warn: warn, error: error, debug: debug };
})(typeof window !== 'undefined' ? window : this);
