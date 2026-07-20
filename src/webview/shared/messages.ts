/*
 * Shared webview message types.
 *
 * Each provider refines this base union with its own message types, but every
 * Forgejo webview message includes one of these baseline shapes for common
 * cross-cutting concerns (logging, theming, modal messaging).
 */

export type ThemeKind = 'light' | 'dark' | 'high-contrast';

/** Messages every webview understands (extended per-provider). */
export type BaseWebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' }
  | { type: 'openUserProfile'; username: string }
  | { type: 'openInBrowserFromUrl'; url: string }
  | { type: 'showConfirm'; id: number; message: string }
  | { type: 'showInputBox'; id: number; prompt: string; defaultValue?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'debug'; message: string; data?: unknown };

/** Messages every webview receives from the extension. */
export type BaseExtensionToWebviewMessage =
  | { type: 'loading'; show: boolean }
  | { type: 'error'; message: string }
  | { type: 'theme'; theme: ThemeKind }
  | { type: 'actionComplete'; action: string; success: boolean }
  | { type: 'modalResult'; id: number; confirmed?: boolean; value?: string };

export const ALL_BASE_WEBVIEW_MESSAGE_TYPES: ReadonlyArray<BaseWebviewToExtensionMessage['type']> = [
  'ready',
  'refresh',
  'openInBrowser',
  'openUserProfile',
  'openInBrowserFromUrl',
  'showConfirm',
  'showInputBox',
  'log',
];

export function isBaseWebviewMessage(message: unknown): message is BaseWebviewToExtensionMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' && (ALL_BASE_WEBVIEW_MESSAGE_TYPES as readonly string[]).includes(type);
}
