import {
  isBaseWebviewMessage,
  ALL_BASE_WEBVIEW_MESSAGE_TYPES,
} from '../../webview/shared/messages';

describe('shared/messages', () => {
  describe('ALL_BASE_WEBVIEW_MESSAGE_TYPES', () => {
    test('includes the common cross-cutting message types', () => {
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('ready');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('refresh');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('openInBrowser');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('openUserProfile');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('openInBrowserFromUrl');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('showConfirm');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('showInputBox');
      expect(ALL_BASE_WEBVIEW_MESSAGE_TYPES).toContain('log');
    });
  });

  describe('isBaseWebviewMessage', () => {
    test('returns true for known baseline message types', () => {
      expect(isBaseWebviewMessage({ type: 'ready' })).toBe(true);
      expect(isBaseWebviewMessage({ type: 'refresh' })).toBe(true);
      expect(isBaseWebviewMessage({ type: 'log', level: 'info', message: 'hi' })).toBe(true);
    });

    test('returns false for provider-specific message types', () => {
      expect(isBaseWebviewMessage({ type: 'merge', strategy: 'squash' })).toBe(false);
      expect(isBaseWebviewMessage({ type: 'closeIssue' })).toBe(false);
      expect(isBaseWebviewMessage({ type: 'rerun' })).toBe(false);
    });

    test('returns false for malformed payloads', () => {
      expect(isBaseWebviewMessage(null)).toBe(false);
      expect(isBaseWebviewMessage(undefined)).toBe(false);
      expect(isBaseWebviewMessage('ready')).toBe(false);
      expect(isBaseWebviewMessage({})).toBe(false);
      expect(isBaseWebviewMessage({ type: 42 })).toBe(false);
      expect(isBaseWebviewMessage({ type: 'unknownType' })).toBe(false);
    });
  });
});
