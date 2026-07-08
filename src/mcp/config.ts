/**
 * MCP server configuration.
 *
 * Resolves the Forgejo instance URL + token + (optional) default owner/repo
 * from the agent's environment. Two resolution paths in priority order:
 *
 * 1. Environment variables (preferred — agents pass these in the `env` block
 *    of their MCP config: .vscode/mcp.json, .mcp.json, .codex/config.toml):
 *      FORGEJO_URL     — base URL of the Forgejo instance (required)
 *      FORGEJO_TOKEN   — personal access token (optional; read-only works
 *                        for public repos but most tools need a token)
 *      FORGEJO_OWNER   — default owner for tools that accept owner/repo
 *      FORGEJO_REPO    — default repo name
 *
 * 2. Config file at ~/.config/forgejo-mcp/instances.json — written by the
 *    "Forgejo: Configure MCP for Agents" command in the VS Code extension.
 *    When present, its `default` entry supplies URL + token + owner + repo.
 *
 * If neither path yields a URL, resolveConfig() throws with a useful message
 * telling the user how to configure the server.
 *
 * The VS Code extension emits instances.json from SecretStorage (which a
 * stdio child process cannot read directly) so the agent's stdio server can
 * authenticate without leaking tokens into the agent's own config files.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface McpInstanceConfig {
	/** Base URL of the Forgejo instance (e.g. https://codeberg.org) */
	instanceUrl: string;
	/** Personal access token; '' for unauthenticated access */
	token: string;
	/** Default owner login used when caller omits owner in a tool call */
	defaultOwner?: string;
	/** Default repo name used when caller omits repo in a tool call */
	defaultRepo?: string;
}

export interface McpInstancesFile {
	default: McpInstanceConfig;
	instances?: McpInstanceConfig[];
}

/** Path to the instances.json config file written by the VS Code extension. */
export function getConfigFilePath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	// Prefer $HOME over os.homedir() so tests can override via process.env.HOME.
	// On Linux, os.homedir() ignores $HOME and reads the system user record.
	const home = process.env.HOME || homedir();
	const configRoot = xdgConfig && xdgConfig.trim() !== ''
		? xdgConfig
		: join(home, '.config');
	return join(configRoot, 'forgejo-mcp', 'instances.json');
}

/** Required env vars that must be present for env-based config resolution. */
export const ENV_INSTANCE_URL = 'FORGEJO_URL';
export const ENV_TOKEN = 'FORGEJO_TOKEN';
export const ENV_OWNER = 'FORGEJO_OWNER';
export const ENV_REPO = 'FORGEJO_REPO';

function readInstancesFile(path: string): McpInstancesFile | null {
	if (!existsSync(path)) {
		return null;
	}
	const raw = readFileSync(path, 'utf8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`MCP config file at ${path} is not valid JSON`);
	}
	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`MCP config file at ${path} must be a JSON object`);
	}
	const obj = parsed as Partial<McpInstancesFile>;
	if (!obj.default || typeof obj.default !== 'object') {
		throw new Error(`MCP config file at ${path} is missing a 'default' object`);
	}
	return obj as McpInstancesFile;
}

function instanceConfigFromEnv(): McpInstanceConfig | null {
	const url = process.env[ENV_INSTANCE_URL];
	if (!url || url.trim() === '') {
		return null;
	}
	return {
		instanceUrl: url.trim(),
		token: process.env[ENV_TOKEN] ?? '',
		defaultOwner: process.env[ENV_OWNER] || undefined,
		defaultRepo: process.env[ENV_REPO] || undefined,
	};
}

function instanceConfigFromFile(): McpInstanceConfig | null {
	const path = getConfigFilePath();
	const file = readInstancesFile(path);
	if (!file) {
		return null;
	}
	return file.default;
}

/**
 * Resolve the active Forgejo instance config.
 *
 * @returns the active instance config, or throws if none is configured.
 * @throws Error when no URL can be resolved via env vars or config file.
 */
export function resolveConfig(): McpInstanceConfig {
	const fromEnv = instanceConfigFromEnv();
	if (fromEnv) {
		return fromEnv;
	}

	const fromFile = instanceConfigFromFile();
	if (fromFile) {
		return fromFile;
	}

	const configPath = getConfigFilePath();
	throw new Error(
		`No Forgejo configuration found. Set the ${ENV_INSTANCE_URL} environment variable ` +
		`(and optionally ${ENV_TOKEN}, ${ENV_OWNER}, ${ENV_REPO}) ` +
		`or run "Forgejo: Configure MCP for Agents" in VS Code to write ${configPath}.`,
	);
}

/** Reset env vars and config cache (testing). Mutates process.env. */
export function _resetEnvForTesting(restore: Record<string, string | undefined>): void {
	const keys = [ENV_INSTANCE_URL, ENV_TOKEN, ENV_OWNER, ENV_REPO];
	for (const k of keys) {
		if (k in restore) {
			process.env[k] = restore[k];
		} else {
			delete process.env[k];
		}
	}
}

/** Snapshot env vars for tests that mock process.env. */
export function _snapshotEnvForTesting(): Record<string, string | undefined> {
	const snapshot: Record<string, string | undefined> = {};
	for (const k of [ENV_INSTANCE_URL, ENV_TOKEN, ENV_OWNER, ENV_REPO]) {
		snapshot[k] = process.env[k];
	}
	return snapshot;
}
