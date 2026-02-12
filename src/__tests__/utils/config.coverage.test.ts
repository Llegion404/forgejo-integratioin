import * as vscode from 'vscode';
import { setInstanceUrl, setAuthToken } from '../../utils/config';

describe('config - uncovered functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setInstanceUrl', () => {
    it('should update instanceUrl in global config', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(undefined);
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn(),
        update: mockUpdate,
        inspect: jest.fn()
      });

      await setInstanceUrl('https://codeberg.org');

      expect(mockUpdate).toHaveBeenCalledWith(
        'instanceUrl',
        'https://codeberg.org',
        vscode.ConfigurationTarget.Global
      );
    });
  });

  describe('setAuthToken', () => {
    it('should update token in global config', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(undefined);
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn(),
        update: mockUpdate,
        inspect: jest.fn()
      });

      await setAuthToken('my-secret-token');

      expect(mockUpdate).toHaveBeenCalledWith(
        'token',
        'my-secret-token',
        vscode.ConfigurationTarget.Global
      );
    });
  });
});
