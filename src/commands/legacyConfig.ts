import * as vscode from 'vscode';
import { setInstanceUrl } from '../utils/config';
import { PRTreeProvider } from '../providers/prTreeProvider';
import { IssueTreeProvider } from '../providers/issueTreeProvider';
import { ActionsTreeProvider } from '../providers/actionsTreeProvider';
import { getDefaultOrFirstInstance } from '../utils/instanceHelpers';
import { setToken } from '../utils/secretStorage';

export function validateUrl(value: string): string | null {
	if (!value) {
		return 'URL is required';
	}
	try {
		new URL(value);
		return null;
	} catch {
		return 'Invalid URL format';
	}
}

export function validateToken(value: string): string | null {
	if (!value) {
		return 'Token is required';
	}
	return null;
}

export async function configureInstanceUrlCommand(
	prTreeProvider: PRTreeProvider,
	issueTreeProvider: IssueTreeProvider,
	actionsTreeProvider: ActionsTreeProvider
): Promise<void> {
	const url = await vscode.window.showInputBox({
		prompt: 'Enter Forgejo instance URL',
		placeHolder: 'https://codeberg.org',
		validateInput: validateUrl
	});

	if (url) {
		await setInstanceUrl(url);
		void vscode.window.showInformationMessage(`Forgejo instance URL set to: ${url}`);
		prTreeProvider.refresh();
		issueTreeProvider.refresh();
		actionsTreeProvider.refresh();
	}
}

export async function setAuthTokenCommand(
	prTreeProvider: PRTreeProvider,
	issueTreeProvider: IssueTreeProvider,
	actionsTreeProvider: ActionsTreeProvider
): Promise<void> {
	const defaultInstance = await getDefaultOrFirstInstance();
	if (!defaultInstance) {
		void vscode.window.showErrorMessage(
			'No Forgejo instance configured. Please add an instance first.',
			'Add Instance'
		).then(action => {
			if (action === 'Add Instance') {
				void vscode.commands.executeCommand('forgejo.addInstance');
			}
		});
		return;
	}

	const token = await vscode.window.showInputBox({
		prompt: 'Enter your Forgejo personal access token',
		placeHolder: 'token_xxxxxxxxxxxxxx',
		password: true,
		validateInput: validateToken
	});

	if (token) {
		await setToken(defaultInstance.id, token);
		void vscode.window.showInformationMessage('Forgejo authentication token saved securely');
		prTreeProvider.refresh();
		issueTreeProvider.refresh();
		actionsTreeProvider.refresh();
	}
}
