/**
 * Meta/diagnostic tools that don't hit the issues or PRs endpoints.
 *
 * `list_instances` — returns the configured instances.json entries (no API
 *   call). Useful for the agent to understand which Forgejo instance it's
 *   talking to and whether a default owner/repo is set.
 *
 * `get_current_user` — calls the Forgejo /user endpoint to fetch the
 *   authenticated user. Acts as a connectivity + token-scope smoke test.
 */

import { Tool } from './framework';
import { objectSchema } from './schema';
import { getConfigFilePath, McpInstanceConfig } from '../config';
import { readFileSync, existsSync } from 'fs';

export const listInstancesTool: Tool = {
	name: 'list_instances',
	description:
		'List the Forgejo instances configured for this MCP server. ' +
		'Does NOT call the Forgejo API — reads the local instances.json file ' +
		'(typically at ~/.config/forgejo-mcp/instances.json) plus the env ' +
		'vars FORGEJO_URL/FORGEJO_OWNER/FORGEJO_REPO. Use this first to ' +
		'confirm the server is wired up before calling other tools.',
	inputSchema: objectSchema({}),
	async handler({ config }: { config: McpInstanceConfig }): Promise<unknown> {
		const envSourced = !!process.env.FORGEJO_URL;
		const filePath = getConfigFilePath();
		const fileExists = existsSync(filePath);
		let fileInstances: unknown[] | null = null;
		if (fileExists) {
			try {
				const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
				if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { instances?: unknown[] }).instances)) {
					fileInstances = (parsed as { instances: unknown[] }).instances;
				}
			} catch {
				// ignore — fall through
			}
		}
		return {
			active: {
				instanceUrl: config.instanceUrl,
				defaultOwner: config.defaultOwner ?? null,
				defaultRepo: config.defaultRepo ?? null,
				hasToken: !!config.token,
				source: envSourced ? 'env-vars' : 'instances.json',
			},
			configFile: fileExists ? filePath : null,
			configFileInstances: fileInstances,
		};
	},
};

export const getCurrentUserTool: Tool = {
	name: 'get_current_user',
	description:
		'Fetch the authenticated Forgejo user by calling GET /user. ' +
		'Use this as a connectivity and token-scope smoke test before ' +
		'calling other tools. Returns the user record (id, login, ' +
		'full_name, email, is_admin, etc.). Requires a token. If the ' +
		'instance URL is for a public/unauthenticated target the call ' +
		'will 401.',
	inputSchema: objectSchema({}),
	async handler({ client }): Promise<unknown> {
		return client.rawRequest('GET', '/user');
	},
};
