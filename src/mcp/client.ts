/**
 * Forgejo API client for the MCP server.
 *
 * Uses the forgejo-ts SDK directly (not the extension's wrapper at
 * src/api/forgejoClient.ts) because the wrapper imports `forgejoLoggerAdapter`
 * which transitively imports 'vscode' — a module that does not exist in a
 * stdio child process. By using forgejo-ts's ForgejoClient with noopLogger,
 * the MCP server stays decoupled from VS Code entirely.
 *
 * All SDK methods are inherited; `rawRequest` is exposed as the universal
 * escape hatch for Forgejo REST endpoints the SDK doesn't have typed methods
 * for (the extension's wrapper uses the same pattern — see
 * src/api/forgejoClient.ts:78-118).
 */

import { ForgejoClient as SdkClient, noopLogger, ForgejoClientOptions } from 'forgejo-ts';

export type { McpInstanceConfig } from './config';

export class McpForgejoClient extends SdkClient {
	constructor(options: ForgejoClientOptions) {
		super({ logger: noopLogger, ...options });
	}
}

/**
 * Build a client from a resolved instance config.
 * Throws if instanceUrl is missing.
 */
export function createClient(config: {
	instanceUrl: string;
	token?: string;
}): McpForgejoClient {
	if (!config.instanceUrl) {
		throw new Error('Cannot create Forgejo client: instanceUrl is empty');
	}
	return new McpForgejoClient({
		instanceUrl: config.instanceUrl,
		token: config.token || undefined,
	});
}
