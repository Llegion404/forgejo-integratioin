import * as vscode from 'vscode';
import { ForgejoInstance } from '../models/instance';
import { generateUUID } from './instanceHelpers';

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

/**
 * Generates a default instance name from URL
 * Examples:
 * - https://codeberg.org → "Codeberg"
 * - https://git.example.com → "git.example.com"
 */
function getDefaultInstanceName(instanceUrl: string): string {
	try {
		const url = new URL(instanceUrl);
		const hostname = url.hostname;

		// Known instances
		const knownInstances: Record<string, string> = {
			'codeberg.org': 'Codeberg',
			'gitea.com': 'Gitea',
			'git.disroot.org': 'Disroot',
		};

		return knownInstances[hostname] || hostname;
	} catch {
		return 'Default Instance';
	}
}

/**
 * Normalizes a URL by removing trailing slashes and ensuring protocol
 */
function normalizeUrl(url: string): string {
	let normalized = url.trim();

	// Add https:// if no protocol
	if (!normalized.match(/^https?:\/\//)) {
		normalized = `https://${normalized}`;
	}

	// Remove trailing slash
	normalized = normalized.replace(/\/$/, '');

	return normalized;
}
