import * as vscode from 'vscode';
import { detectGitRemote } from './gitUtils';
import { ForgejoInstance } from '../models/instance';
import {
	getAllInstances,
	getDefaultOrFirstInstance,
	findBestInstanceMatch,
	normalizeUrl
} from './instanceHelpers';
import { logInfo, logDebug } from './logger';

export interface ForgejoConfig {
	instanceUrl: string;
	token: string;
	owner: string;
	repo: string;
	instanceId?: string;
	matchConfidence?: 'exact' | 'domain' | 'default' | 'first';
}

/**
 * Get Forgejo configuration from VS Code settings
 */
export async function getForgejoConfig(): Promise<ForgejoConfig | null> {
	logDebug('Getting configuration...');

	// Get all configured instances
	const instances = await getAllInstances();

	// Get preferred remote name from configuration
	const forgejoSettings = vscode.workspace.getConfiguration('forgejo');
	const preferredRemote = forgejoSettings.get<string>('preferredRemote', '');

	// Get git remote info, using preferred remote if configured
	const gitInfo = await detectGitRemote(preferredRemote || undefined);

	let selectedInstance: ForgejoInstance | undefined;
	let confidence: 'exact' | 'domain' | 'default' | 'first' = 'first';

	if (instances.length > 0) {
		// Try to match instance to git remote
		if (gitInfo) {
			const match = findBestInstanceMatch(instances, gitInfo.instanceUrl);
			if (match) {
				selectedInstance = match.instance;
				confidence = match.confidence;
				logInfo(`Matched instance: ${selectedInstance.name} (${confidence} match)`);
			}
		}

		// Fall back to default or first instance
		if (!selectedInstance) {
			selectedInstance = await getDefaultOrFirstInstance();
			confidence = selectedInstance?.isDefault ? 'default' : 'first';

			if (selectedInstance) {
				logInfo(`Using ${confidence} instance: ${selectedInstance.name}`);
			}
		}
	}

	// If we don't have git info, we can't determine owner/repo
	if (!gitInfo) {
		logInfo('Could not determine owner/repo from git remote');
		return null;
	}

	// If no instance matched but we have git remote info, try unauthenticated access
	// This enables zero-config browsing of public repos
	if (!selectedInstance) {
		logInfo('No instances configured, using git remote for unauthenticated access');
		const finalConfig: ForgejoConfig = {
			instanceUrl: normalizeUrl(gitInfo.instanceUrl),
			token: '',
			owner: gitInfo.owner,
			repo: gitInfo.repo,
			matchConfidence: 'default'
		};

		logDebug('Final configuration (unauthenticated):', {
			...finalConfig,
			token: '(not set)'
		});

		return finalConfig;
	}

	const finalConfig: ForgejoConfig = {
		instanceUrl: normalizeUrl(selectedInstance.instanceUrl),
		token: selectedInstance.token,
		owner: gitInfo.owner,
		repo: gitInfo.repo,
		instanceId: selectedInstance.id,
		matchConfidence: confidence
	};

	logDebug('Final configuration:', {
		...finalConfig,
		token: finalConfig.token ? '***' : '(not set)'
	});

	return finalConfig;
}

/**
 * Set instance URL in configuration
 */
export async function setInstanceUrl(url: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update('instanceUrl', url, vscode.ConfigurationTarget.Global);
}

/**
 * Set authentication token in configuration
 */
export async function setAuthToken(token: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update('token', token, vscode.ConfigurationTarget.Global);
}
