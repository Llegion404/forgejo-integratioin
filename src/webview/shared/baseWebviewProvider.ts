import * as vscode from 'vscode';
import { logDebug, logError } from '../../utils/logger';
import { getForgejoConfig } from '../../utils/config';
import type { ThemeKind } from './messages';

/**
 * Common scaffolding for all Forgejo detail-webview providers.
 *
 * Subclasses provide:
 *   - readonly viewType: string
 *   - panel-state type TPanelState with at minimum { panel, owner, repo, isReady, lastRequestId }
 *   - protected getHtmlForWebview(webview): string
 *
 * The base provides:
 *   - Panel-map accessor
 *   - Theme listener registration + broadcast (B1.4)
 *   - Nonce + CSP helpers (B2.7)
 *   - Shared asset URI helpers (base.css / tokens.css / util.js / markdown.js / theme.js / reactions.js / log.js)
 *   - Generic webview-to-extension log forwarding (B2.8)
 */
export abstract class BaseDetailWebviewProvider<TPanelState extends BasePanelState> {
  protected readonly _panels = new Map<string, TPanelState>();
  private _themeListenerDisposable?: vscode.Disposable;

  constructor(protected readonly _extensionUri: vscode.Uri) {}

  public abstract readonly viewType: string;

  /* ----- Theme broadcasting (B1.4) ----- */
  public broadcastTheme(theme: ThemeKind): void {
    for (const state of this._panels.values()) {
      if (state.isReady) {
        void state.panel.webview.postMessage({ type: 'theme', theme });
      }
    }
  }

  public registerThemeListener(): vscode.Disposable {
    if (this._themeListenerDisposable) return this._themeListenerDisposable;
    this._themeListenerDisposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
      this.broadcastTheme(this._getThemeName(theme.kind));
    });
    return this._themeListenerDisposable;
  }

  /* ----- Nonce + CSP (B2.7) ----- */
  protected _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Builds a nonce-based Content-Security-Policy. All providers should use this
   * instead of `unsafe-inline` (B2.7).
   */
  protected _buildCsp(nonce: string, webview: vscode.Webview): string {
    return [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
  }

  protected _getThemeName(kind: vscode.ColorThemeKind): ThemeKind {
    switch (kind) {
      case vscode.ColorThemeKind.Light: return 'light';
      case vscode.ColorThemeKind.HighContrast:
      case vscode.ColorThemeKind.HighContrastLight:
        return 'high-contrast';
      default: return 'dark';
    }
  }

  /* ----- Shared asset URIs (B2.10) ----- */
  protected _sharedCssUri(webview: vscode.Webview, file: string): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'shared', file));
  }

  protected _sharedJsUri(webview: vscode.Webview, file: string): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'shared', file));
  }

  /**
   * URI for a vendored static asset under media/ (e.g. codicon font/css, brand mark).
   * These live at the extension root and are referenced directly (not compiled to out/).
   */
  protected _mediaUri(webview: vscode.Webview, file: string): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', file));
  }

  /**
   * HTML snippet that links every shared asset (tokens.css, base.css, codicon.css,
   * util.js, markdown.js, theme.js, reactions.js, log.js). Each provider's
   * getHtmlForWebview includes this in <head> / before its inline script.
   */
  protected _sharedAssetsHtml(webview: vscode.Webview): string {
    const tokens = this._sharedCssUri(webview, 'tokens.css').toString();
    const base = this._sharedCssUri(webview, 'base.css').toString();
    const codicons = this._mediaUri(webview, 'codicon.css').toString();
    const util = this._sharedJsUri(webview, 'util.js').toString();
    const md = this._sharedJsUri(webview, 'markdown.js').toString();
    const theme = this._sharedJsUri(webview, 'theme.js').toString();
    const reactions = this._sharedJsUri(webview, 'reactions.js').toString();
    const log = this._sharedJsUri(webview, 'log.js').toString();
    return [
      `<link rel="stylesheet" href="${tokens}">`,
      `<link rel="stylesheet" href="${base}">`,
      `<link rel="stylesheet" href="${codicons}">`,
      `<script src="${util}"></script>`,
      `<script src="${md}"></script>`,
      `<script src="${theme}"></script>`,
      `<script src="${reactions}"></script>`,
      `<script src="${log}"></script>`,
    ].join('\n  ');
  }

  /* ----- Log forwarding from webview (B2.8) ----- */
  protected _handleLogMessage(message: { level: 'info' | 'warn' | 'error' | 'debug'; message: string; data?: unknown }): void {
    logDebug(`[webview:${this.viewType}] ${message.message}`, message.data);
  }

  /* ----- Modal helpers shared by all providers (B1.9) ----- */
  protected async _handleShowConfirm(panel: vscode.Webview | undefined, id: number, message: string): Promise<void> {
    if (!panel) return;
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Yes', 'No');
    void panel.postMessage({ type: 'modalResult', id, confirmed: choice === 'Yes' });
  }

  protected async _handleShowInputBox(panel: vscode.Webview | undefined, id: number, prompt: string, defaultValue?: string): Promise<void> {
    if (!panel) return;
    const value = await vscode.window.showInputBox({ prompt, value: defaultValue });
    void panel.postMessage({ type: 'modalResult', id, value });
  }

  /* ----- Generic URL opening (single impl; replaces per-provider copies) ----- */
  protected _openExternal(url: string): void {
    try {
      if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      logError('Failed to open URL:', error);
    }
  }

  protected async _openUserProfile(username: string): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No Forgejo config');
      this._openExternal(`${config.instanceUrl}/${encodeURIComponent(username)}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to open profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Router for the generic message types every webview understands. Subclasses
   * call this at the top of their message switch and bail when it returns true,
   * eliminating the duplicated `log` / `showConfirm` / `showInputBox` /
   * `openUserProfile` / `openInBrowserFromUrl` case blocks (and the dead-handler
   * pattern they invite). Entity-specific types stay in the subclass.
   */
  protected async _handleBaseMessage(message: unknown, panel: vscode.Webview | undefined): Promise<boolean> {
    const m = message as { type?: string; [k: string]: unknown };
    switch (m.type) {
      case 'log':
        this._handleLogMessage(m as Parameters<BaseDetailWebviewProvider<TPanelState>['_handleLogMessage']>[0]);
        return true;
      case 'showConfirm':
        await this._handleShowConfirm(panel, Number(m.id), String(m.message ?? ''));
        return true;
      case 'showInputBox':
        await this._handleShowInputBox(panel, Number(m.id), String(m.prompt ?? ''), m.defaultValue as string | undefined);
        return true;
      case 'openUserProfile':
        await this._openUserProfile(String(m.username ?? ''));
        return true;
      case 'openInBrowserFromUrl':
        this._openExternal(String(m.url ?? ''));
        return true;
      default:
        return false;
    }
  }

  /**
   * Race-guarded fetch. Increments the panel's request id, runs `fn`, and
   * returns its result only if this request is still the latest; returns null
   * when a newer refresh superseded it. Subclasses should also check
   * `state.lastRequestId === id` at their inner await points for long fan-outs.
   */
  protected async _runGuarded<R>(state: BasePanelState, fn: (id: number) => Promise<R>): Promise<R | null> {
    const id = ++state.lastRequestId;
    const result = await fn(id);
    if (state.lastRequestId !== id) return null;
    return result;
  }
}

export interface BasePanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  isReady: boolean;
  lastRequestId: number;
}
