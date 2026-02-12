import * as vscode from 'vscode';
import { logger, logInfo, logWarn, logError, logDebug, showOutput } from '../../utils/logger';

// The logger singleton lazily creates an output channel.
// Due to resetMocks: true in jest config, we need to capture the
// output channel reference before mocks are reset.
// We do this by triggering lazy init and capturing the returned mock.
let mockOutputChannel: any;

beforeAll(() => {
  // Set up the createOutputChannel mock to return a trackable object
  mockOutputChannel = {
    append: jest.fn(),
    appendLine: jest.fn(),
    replace: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    name: 'Forgejo'
  };
  (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);

  // Trigger lazy initialization
  logger.info('test-init');
});

describe('Logger', () => {
  beforeEach(() => {
    // Clear call history but keep the mock channel alive
    mockOutputChannel.appendLine.mockClear();
    mockOutputChannel.show.mockClear();
    mockOutputChannel.clear.mockClear();
    mockOutputChannel.dispose.mockClear();
  });

  describe('info()', () => {
    it('should log formatted info message to output channel', () => {
      logger.info('Test message');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Test message')
      );
    });

    it('should include timestamp in message', () => {
      logger.info('Test');
      const call = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should format object args as JSON', () => {
      logger.info('Test', { key: 'value' });
      const call = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(call).toContain('"key": "value"');
    });

    it('should format string args', () => {
      logger.info('Test', 'extra', 'args');
      const call = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(call).toContain('extra args');
    });
  });

  describe('warn()', () => {
    it('should log formatted warn message to output channel', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      logger.warn('Warning message');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Warning message')
      );
      consoleSpy.mockRestore();
    });

    it('should also log to console.warn', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      logger.warn('Warning');
      expect(consoleSpy).toHaveBeenCalledWith('[Forgejo] Warning');
      consoleSpy.mockRestore();
    });
  });

  describe('error()', () => {
    it('should log formatted error message to output channel', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logger.error('Error message');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
      consoleSpy.mockRestore();
    });

    it('should also log to console.error', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logger.error('Error');
      expect(consoleSpy).toHaveBeenCalledWith('[Forgejo] Error');
      consoleSpy.mockRestore();
    });
  });

  describe('debug()', () => {
    it('should not throw when called (debug disabled by default in tests)', () => {
      expect(() => logger.debug('Debug message')).not.toThrow();
    });
  });

  describe('show()', () => {
    it('should call show on the output channel', () => {
      logger.show();
      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('should call clear on the output channel', () => {
      logger.clear();
      expect(mockOutputChannel.clear).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('should call dispose on the output channel', () => {
      logger.dispose();
      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('convenience functions', () => {
    it('logInfo should log info message', () => {
      logInfo('Test message');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Test message')
      );
    });

    it('logWarn should log warn message', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      logWarn('Warning');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Warning')
      );
      consoleSpy.mockRestore();
    });

    it('logError should log error message', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logError('Error');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error')
      );
      consoleSpy.mockRestore();
    });

    it('logDebug should not throw', () => {
      expect(() => logDebug('Debug')).not.toThrow();
    });

    it('showOutput should call show on output channel', () => {
      showOutput();
      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
  });
});
