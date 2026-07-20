/*
 * Theme application helper for all Forgejo webviews.
 *
 * Usage from inline script:
 *   window.ForgejoTheme.apply('dark');
 *
 * Sets one of `vscode-light` / `vscode-dark` / `vscode-high-contrast` classes
 * on <body> so per-webview CSS can theme via descendant selectors.
 */
(function (global) {
  function apply(theme) {
    document.body.classList.remove('vscode-light', 'vscode-dark', 'vscode-high-contrast');
    if (theme === 'light') document.body.classList.add('vscode-light');
    else if (theme === 'high-contrast') document.body.classList.add('vscode-high-contrast');
    else document.body.classList.add('vscode-dark');
  }

  global.ForgejoTheme = { apply: apply };
})(typeof window !== 'undefined' ? window : this);
