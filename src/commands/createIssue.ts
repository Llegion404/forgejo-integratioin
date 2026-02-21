import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { logInfo, logError } from '../utils/logger';
import { IssueTreeProvider } from '../providers/issueTreeProvider';

/**
 * Handles the forgejo.createIssue command.
 * Extracted from extension.ts for unit testability.
 */
export async function createIssueCommand(issueTreeProvider: IssueTreeProvider): Promise<void> {
	try {
		const config = await getForgejoConfig();
		if (!config) {
			void vscode.window.showErrorMessage('Forgejo configuration not found. Please configure an instance first.');
			return;
		}

		if (!config.token) {
			void vscode.window.showErrorMessage('A Forgejo token is required to create issues. Please configure your token first.');
			return;
		}

		// Prompt for issue title
		const title = await vscode.window.showInputBox({
			prompt: 'Enter issue title',
			placeHolder: 'Issue title',
			validateInput: (value) => {
				if (!value.trim()) {
					return 'Title is required';
				}
				return null;
			}
		});

		if (!title) {
			return; // User cancelled
		}

		// Prompt for issue body (optional)
		const body = await vscode.window.showInputBox({
			prompt: 'Enter issue description (optional)',
			placeHolder: 'Brief description (you can edit the full description in the browser after creation)'
		});

		if (body === undefined) {
			return; // User cancelled (pressing Escape)
		}

		// Create the issue
		const client = new ForgejoClient(config.instanceUrl, config.token);
		const issue = await client.createIssue(config.owner, config.repo, title.trim(), body.trim() || undefined);

		logInfo(`Issue #${issue.number} created: ${issue.title}`);

		// Refresh immediately so the new issue appears regardless of notification interaction
		issueTreeProvider.refresh();

		const action = await vscode.window.showInformationMessage(
			`Issue #${issue.number} created successfully!`,
			'Open in Browser'
		);

		if (action === 'Open in Browser') {
			void vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
		}
	} catch (error) {
		logError('Error creating issue:', error);
		void vscode.window.showErrorMessage(
			`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}
