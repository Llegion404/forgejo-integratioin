import * as vscode from 'vscode';
import { startOnboarding } from '../../commands/onboarding';

// Mock dependencies
jest.mock('../../utils/instanceHelpers');
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn()
}));

import {
  generateUUID,
  normalizeUrl,
  getDefaultInstanceName,
  addInstance,
  testInstanceConnection
} from '../../utils/instanceHelpers';

const mockGenerateUUID = generateUUID as jest.MockedFunction<typeof generateUUID>;
const mockNormalizeUrl = normalizeUrl as jest.MockedFunction<typeof normalizeUrl>;
const mockGetDefaultInstanceName = getDefaultInstanceName as jest.MockedFunction<typeof getDefaultInstanceName>;
const mockAddInstance = addInstance as jest.MockedFunction<typeof addInstance>;
const mockTestInstanceConnection = testInstanceConnection as jest.MockedFunction<typeof testInstanceConnection>;

// Override setTimeout to be immediate for tests
const originalSetTimeout = global.setTimeout;
beforeAll(() => {
  global.setTimeout = ((fn: Function) => { fn(); return 0; }) as any;
});
afterAll(() => {
  global.setTimeout = originalSetTimeout;
});

describe('onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateUUID.mockReturnValue('test-uuid');
    mockNormalizeUrl.mockImplementation((url: string) => url.startsWith('http') ? url : `https://${url}`);
    mockGetDefaultInstanceName.mockReturnValue('Test Instance');
  });

  describe('startOnboarding', () => {
    it('should return false when user cancels URL input', async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await startOnboarding();

      expect(result).toBe(false);
    });

    it('should return false when user cancels token input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org') // URL
        .mockResolvedValueOnce(undefined); // Token cancelled

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

      const result = await startOnboarding();

      expect(result).toBe(false);
    });

    it('should return false when user cancels name input', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org') // URL
        .mockResolvedValueOnce('test-token') // Token
        .mockResolvedValueOnce(undefined); // Name cancelled

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);

      const result = await startOnboarding();

      expect(result).toBe(false);
    });

    it('should open browser for token creation', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce(undefined); // Cancel at token

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

      await startOnboarding();

      expect(vscode.env.openExternal).toHaveBeenCalled();
    });

    it('should save instance on successful flow', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org') // URL
        .mockResolvedValueOnce('test-token') // Token
        .mockResolvedValueOnce('My Codeberg'); // Name

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await startOnboarding();

      expect(result).toBe(true);
      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid',
          name: 'My Codeberg',
          instanceUrl: 'https://codeberg.org',
          token: 'test-token'
        })
      );
    });

    it('should show success message when connection test passes', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('Codeberg');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await startOnboarding();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Successfully added Forgejo instance'),
        'View Instances',
        'Show Output'
      );
    });

    it('should allow saving when connection test fails and user chooses Save Anyway', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token')
        .mockResolvedValueOnce('Codeberg');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Save Anyway');
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await startOnboarding();

      expect(result).toBe(true);
      expect(mockAddInstance).toHaveBeenCalled();
    });

    it('should return false when connection test fails and user cancels', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');

      const result = await startOnboarding();

      expect(result).toBe(false);
      expect(mockAddInstance).not.toHaveBeenCalled();
    });

    it('should return false when connection test fails and user dismisses dialog', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await startOnboarding();

      expect(result).toBe(false);
    });

    it('should handle addInstance failure', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('Codeberg');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockRejectedValue(new Error('Storage error'));
      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

      const result = await startOnboarding();

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save instance: Storage error'),
        'Show Output'
      );
    });

    it('should show warning message when saved with failed connection', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('bad-token')
        .mockResolvedValueOnce('Codeberg');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(false);
      (vscode.window.showWarningMessage as jest.Mock)
        .mockResolvedValueOnce('Save Anyway')
        .mockResolvedValue(undefined);
      mockAddInstance.mockResolvedValue(undefined);

      await startOnboarding();

      // showWarningMessage is called at least twice: save anyway prompt + saved but failed notification
      expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
    });

    it('should trim token whitespace', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('  test-token  ')
        .mockResolvedValueOnce('Codeberg');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await startOnboarding();

      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'test-token' })
      );
    });

    it('should trim name whitespace', async () => {
      (vscode.window.showInputBox as jest.Mock)
        .mockResolvedValueOnce('https://codeberg.org')
        .mockResolvedValueOnce('test-token')
        .mockResolvedValueOnce('  My Instance  ');

      (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
      (vscode.window.withProgress as jest.Mock).mockImplementation(async (_opts: any, task: any) => task());
      mockTestInstanceConnection.mockResolvedValue(true);
      mockAddInstance.mockResolvedValue(undefined);
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

      await startOnboarding();

      expect(mockAddInstance).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Instance' })
      );
    });
  });
});
