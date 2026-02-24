import * as vscode from 'vscode';

jest.mock('../../utils/config', () => ({
	setInstanceUrl: jest.fn(),
	setAuthToken: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
	logInfo: jest.fn(),
	logError: jest.fn(),
}));

import {
	configureInstanceUrlCommand,
	setAuthTokenCommand,
	validateUrl,
	validateToken,
} from '../../commands/legacyConfig';
import { setInstanceUrl, setAuthToken } from '../../utils/config';

const mockSetInstanceUrl = setInstanceUrl as jest.MockedFunction<typeof setInstanceUrl>;
const mockSetAuthToken = setAuthToken as jest.MockedFunction<typeof setAuthToken>;

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
		mockSetAuthToken.mockResolvedValue(undefined);
	});

	it('returns early without saving when user cancels (showInputBox returns undefined)', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);

		await setAuthTokenCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetAuthToken).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(mockPRTreeProvider.refresh).not.toHaveBeenCalled();
		expect(mockIssueTreeProvider.refresh).not.toHaveBeenCalled();
		expect(mockActionsTreeProvider.refresh).not.toHaveBeenCalled();
	});

	it('saves token, shows info message, and refreshes all three providers on success', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('token_abc123');

		await setAuthTokenCommand(
			mockPRTreeProvider as any,
			mockIssueTreeProvider as any,
			mockActionsTreeProvider as any
		);

		expect(mockSetAuthToken).toHaveBeenCalledWith('token_abc123');
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Forgejo authentication token saved'
		);
		expect(mockPRTreeProvider.refresh).toHaveBeenCalled();
		expect(mockIssueTreeProvider.refresh).toHaveBeenCalled();
		expect(mockActionsTreeProvider.refresh).toHaveBeenCalled();
	});
});
