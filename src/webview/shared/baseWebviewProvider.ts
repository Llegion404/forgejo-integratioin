import * as vscode from 'vscode';
import { logDebug } from '../../utils/logger';
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
   * HTML snippet that links every shared asset (tokens.css, base.css, util.js,
   * markdown.js, theme.js, reactions.js, log.js). Each provider's
   * getHtmlForWebview includes this in <head> / before its inline script.
   */
  protected _sharedAssetsHtml(webview: vscode.Webview): string {
    const tokens = this._sharedCssUri(webview, 'tokens.css').toString();
    const base = this._sharedCssUri(webview, 'base.css').toString();
    const util = this._sharedJsUri(webview, 'util.js').toString();
    const md = this._sharedJsUri(webview, 'markdown.js').toString();
    const theme = this._sharedJsUri(webview, 'theme.js').toString();
    const reactions = this._sharedJsUri(webview, 'reactions.js').toString();
    const log = this._sharedJsUri(webview, 'log.js').toString();
    return [
      `<link rel="stylesheet" href="${tokens}">`,
      `<link rel="stylesheet" href="${base}">`,
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
}

export interface BasePanelState {
  panel: vscode.WebviewPanel;
  owner: string;
  repo: string;
  isReady: boolean;
  lastRequestId: number;
}
