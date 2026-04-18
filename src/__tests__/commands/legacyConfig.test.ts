import * as vscode from 'vscode';

jest.mock('../../utils/config', () => ({
	setInstanceUrl: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
	logInfo: jest.fn(),
	logError: jest.fn(),
}));

jest.mock('../../utils/instanceHelpers', () => ({
	getDefaultOrFirstInstance: jest.fn(),
}));

jest.mock('../../utils/secretStorage', () => ({
	setToken: jest.fn().mockResolvedValue(undefined),
}));

import {
	configureInstanceUrlCommand,
	setAuthTokenCommand,
	validateUrl,
	validateToken,
} from '../../commands/legacyConfig';
import { setInstanceUrl } from '../../utils/config';
import { getDefaultOrFirstInstance } from '../../utils/instanceHelpers';
import { setToken } from '../../utils/secretStorage';

const mockSetInstanceUrl = setInstanceUrl as jest.MockedFunction<typeof setInstanceUrl>;
const mockGetDefaultOrFirstInstance = getDefaultOrFirstInstance as jest.MockedFunction<typeof getDefaultOrFirstInstance>;
const mockSetToken = setToken as jest.MockedFunction<typeof setToken>;

describe('validateUrl', () => {
	it('returns null for a valid URL', () => {
		expect(validateUrl('https://codeberg.org')).toBeNull();
	});

	it('returns error message for empty string', () => {
		expect(validateUrl('')).toBe('URL is required');
	});

	it('returns error message for invalid URL format', () => {
		expect(validateUrl('not-a-url')).toBe('Invalid URL format');
	});
});

describe('validateToken', () => {
	it('returns null for a non-empty token', () => {
		expect(validateToken('my-token')).toBeNull();
	});

	it('returns error message for empty string', () => {
		expect(validateToken('')).toBe('Token is required');
	});
});

describe('configureInstanceUrlCommand', () => {
	let mockPRTreeProvider: { refresh: jest.Mock };
	let mockIssueTreeProvider: { refresh: jest.Mock };
	let mockActionsTreeProvider: { refresh: jest.Mock };

	beforeEach(() => {
		jest.clearAllMocks();
		mockPRTreeProvider = { refresh: jest.fn() };
		mockIssueTreeProvider = { refresh: jest.fn() };
		mockActionsTreeProvider = { refresh: jest.fn() };
		mockSetInstanceUrl.mockResolvedValue(undefined);
	});

	it('returns early without saving when user cancels (showInputBox returns undefined)', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

		await configureInstanceUrlCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetInstanceUrl).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
		expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
		expect(mockActionsTreeProvider.refresh).not.toHaveBeenCalled();
	});

	it('saves URL, shows info message, and refreshes all three providers on success', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('https://git.example.com');

		await configureInstanceUrlCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetInstanceUrl).toHaveBeenCalledWith('https://git.example.com');
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Forgejo instance URL set to: https://git.example.com'
		);
		expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
		expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
		expect(mockActionsTreeProvider.refresh).toHaveBeenCalled();
	});
});

describe('setAuthTokenCommand', () => {
	let mockPRTreeProvider: { refresh: jest.Mock };
	let mockIssueTreeProvider: { refresh: jest.Mock };
	let mockActionsTreeProvider: { refresh: jest.Mock };

	beforeEach(() => {
		jest.clearAllMocks();
		mockPRTreeProvider = { refresh: jest.fn() };
		mockIssueTreeProvider = { refresh: jest.fn() };
		mockActionsTreeProvider = { refresh: jest.fn() };
	});

	it('shows error when no instance configured', async () => {
		mockGetDefaultOrFirstInstance.mockResolvedValue(undefined);
		(vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

		await setAuthTokenCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'No Forgejo instance configured. Please add an instance first.',
			'Add Instance'
		);
		expect(mockSetToken).not.toHaveBeenCalled();
	});

	it('returns early without saving when user cancels (showInputBox returns undefined)', async () => {
		mockGetDefaultOrFirstInstance.mockResolvedValue({
			id: '1', name: 'Test', instanceUrl: 'https://test.com'
		});
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

		await setAuthTokenCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetToken).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
	});

	it('saves token to SecretStorage, shows info message, and refreshes providers', async () => {
		mockGetDefaultOrFirstInstance.mockResolvedValue({
			id: '1', name: 'Test', instanceUrl: 'https://test.com'
		});
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('token_abc123');

		await setAuthTokenCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetToken).toHaveBeenCalledWith('1', 'token_abc123');
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Forgejo authentication token saved securely'
		);
		expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
		expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
		expect(mockActionsTreeProvider.refresh).toHaveBeenCalled();
	});
});
