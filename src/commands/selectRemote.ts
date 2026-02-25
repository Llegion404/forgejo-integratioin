import * as vscode from 'vscode';
import { detectAllGitRemotes } from '../utils/gitUtils';
import { logInfo, logError } from '../utils/logger';
import { PRTreeProvider } from '../providers/prTreeProvider';
import { IssueTreeProvider } from '../providers/issueTreeProvider';
import { ActionsTreeProvider } from '../providers/actionsTreeProvider';

/**
 * Handles the forgejo.selectRemote command.
 * Extracted from extension.ts for unit testability.
 */
export async function selectRemoteCommand(
	prTreeProvider: PRTreeProvider,
	issueTreeProvider: IssueTreeProvider,
	actionsTreeProvider: ActionsTreeProvider
): Promise<void> {
	try {
		const remotes = detectAllGitRemotes();

		if (remotes.size === 0) {
			void vscode.window.showInformationMessage('No git remotes found in the current workspace.');
			return;
		}

		// Build quick pick items with remote name and URL
		const items = Array.from(remotes.entries()).map(([name, info]) => ({
			label: name,
			description: `${info.instanceUrl}/${info.owner}/${info.repo}`,
			remoteName: name
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a git remote to use for Forgejo'
		});

		if (!selected) {
			return; // User cancelled
		}

		// Save the selected remote to configuration
		const config = vscode.workspace.getConfiguration('forgejo');
		await config.update('preferredRemote', selected.remoteName, vscode.ConfigurationTarget.Workspace);

		logInfo(`Selected git remote: ${selected.remoteName}`);
		void vscode.window.showInformationMessage(`Forgejo remote set to: ${selected.label}`);

		// Refresh all tree providers
		prTreeProvider.refresh();
		issueTreeProvider.refresh();
		actionsTreeProvider.refresh();
	} catch (error) {
		logError('Error selecting git remote:', error);
		void vscode.window.showErrorMessage(
			`Failed to select git remote: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}
