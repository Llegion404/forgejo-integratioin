import * as vscode from 'vscode';
import { ForgejoInstance } from '../models/instance';
import { generateUUID, normalizeUrl, getDefaultInstanceName } from './instanceHelpers';

/**
 * Migrates legacy single-instance configuration to multi-instance format
 */
export async function migrateToMultiInstance(): Promise<void> {
	const config = vscode.workspace.getConfiguration('forgejo');
	const instances = config.get<ForgejoInstance[]>('instances');

	// Already migrated or no legacy config
	if (instances && instances.length > 0) {
		return;
	}

	// Check for legacy config
	const legacyUrl = config.get<string>('instanceUrl');
	const legacyToken = config.get<string>('token');

	if (legacyUrl && legacyUrl.trim() !== '') {
		const instance: ForgejoInstance = {
			id: generateUUID(),
			name: getDefaultInstanceName(legacyUrl),
			instanceUrl: normalizeUrl(legacyUrl),
			token: legacyToken || '',
			isDefault: true
		};

		await config.update('instances', [instance], vscode.ConfigurationTarget.Global);
		console.log('[Forgejo] Migrated legacy config to multi-instance');
		console.log(`[Forgejo] Created instance: ${instance.name} (${instance.instanceUrl})`);
	}
}


