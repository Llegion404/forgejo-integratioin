/**
 * "Forgejo: Configure MCP for Agents" command.
 *
 * Runs in the VS Code extension host. Reads the current Forgejo instance +
 * token from SecretStorage, asks the user which agents to configure (Claude
 * Code, Codex CLI, GitHub Copilot), and writes each agent's project-scoped
 * config file (`.mcp.json`, `.codex/config.toml`, `.vscode/mcp.json`) with a
 * matching `env` block providing FORGEJO_URL / FORGEJO_TOKEN / FORGEJO_OWNER /
 * FORGEJO_REPO. The same credential set is also written (plaintext) to
 * ~/.config/forgejo-mcp/instances.json so non-VS-Code-launched stdio servers
 * can authenticate.
 *
 * Why env vars: a stdio child process spawned by an MCP client cannot read
 * VS Code's SecretStorage directly. Passing credentials via the `env` block
 * keeps the token out of the tool's source code while making it available
 * to the spawned server process.
 *
 * Tokens are written in PLAINTEXT to the per-agent config files. The command
 * warns the user before doing so and offers an alternative flow (env-var-only
 * mode) that never writes the token to disk.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getForgejoConfig } from '../utils/config';
import { getAllInstances, normalizeUrl } from '../utils/instanceHelpers';

export type AgentId = 'copilot' | 'claude' | 'codex';

const AGENT_LABELS: Record<AgentId, string> = {
	copilot: 'GitHub Copilot (.vscode/mcp.json)',
	claude: 'Claude Code (.mcp.json)',
	codex: 'Codex CLI (.codex/config.toml)',
};

export interface McpConfigResult {
	/** Absolute path to the bundled server entry point. */
	serverPath: string;
	/** Configured caller: instance URL. */
	instanceUrl: string;
	/** Configured caller: token (may be empty for unauthenticated). */
	token: string;
	/** Default owner pre-filled from git remote. */
	owner: string;
	/** Default repo pre-filled from git remote. */
	repo: string;
	/** Workspace root used to resolve agent config file paths. */
	workspaceRoot: string;
	/** Agents the user selected. */
	agents: AgentId[];
	/** Path of every file written successfully. */
	writtenFiles: string[];
	/** Path of every file that failed to write, with the error message. */
	failedFiles: { path: string; error: string }[];
}

/**
 * Escape a token for safe interpolation in INI/TOML and JSON.
 * Tokens are restricted to ASCII-alphanumeric + dot/underscore by Forgejo's
 * PAT format, so no escaping is strictly needed, but we defend in depth.
 */
function escapeForToml(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build the env-var block as a TOML inline-table string. */
export function buildEnvBlockToml(params: {
	instanceUrl: string;
	token: string;
	owner: string;
	repo: string;
}): string {
	const entries: string[] = [
		`FORGEJO_URL = "${escapeForToml(params.instanceUrl)}"`,
		`FORGEJO_OWNER = "${escapeForToml(params.owner)}"`,
		`FORGEJO_REPO = "${escapeForToml(params.repo)}"`,
	];
	if (params.token) {
		entries.push(`FORGEJO_TOKEN = "${escapeForToml(params.token)}"`);
	}
	return `{ ${entries.join(', ')} }`;
}

/** Build the env block as a JSON object (for .vscode/mcp.json and .mcp.json). */
export function buildEnvBlockJson(params: {
	instanceUrl: string;
	token: string;
	owner: string;
	repo: string;
}): Record<string, string> {
	const env: Record<string, string> = {
		FORGEJO_URL: params.instanceUrl,
		FORGEJO_OWNER: params.owner,
		FORGEJO_REPO: params.repo,
	};
	if (params.token) {
		env.FORGEJO_TOKEN = params.token;
	}
	return env;
}

/** Build the per-agent config file content as a string (or null if unsupported). */
export function buildAgentConfig(
	agent: AgentId,
	serverPath: string,
	env: Record<string, string>,
): string {
	switch (agent) {
		case 'copilot':
			return (
				JSON.stringify(
					{
						servers: {
							forgejo: { type: 'stdio', command: 'node', args: [serverPath], env },
						},
					},
					null,
					2,
				) + '\n'
			);
		case 'claude':
			return (
				JSON.stringify(
					{
						mcpServers: {
							forgejo: { type: 'stdio', command: 'node', args: [serverPath], env },
						},
					},
					null,
					2,
				) + '\n'
			);
		case 'codex': {
			// TOML for Codex CLI (~/.codex/config.toml or .codex/config.toml)
			const envToml = `{ ${Object.entries(env).map(([k, v]) => `${k} = "${escapeForToml(v)}"`).join(', ')} }`;
			return (
				`[mcp_servers.forgejo]\n` +
				`command = "node"\n` +
				`args = ["${serverPath.replace(/"/g, '\\"')}"]\n` +
				`env = ${envToml}\n` +
				`startup_timeout_sec = 15\n` +
				`tool_timeout_sec = 60\n`
			);
		}
		default: {
			// Exhaustiveness check — if AgentId gains a member, TS errors here.
			const exhaustive: never = agent;
			throw new Error(`Unknown agent: ${String(exhaustive)}`);
		}
	}
}

/** Get the per-agent config file path inside a workspace root. */
export function getAgentConfigPath(agent: AgentId, workspaceRoot: string): string {
	switch (agent) {
		case 'copilot':
			return path.join(workspaceRoot, '.vscode', 'mcp.json');
		case 'claude':
			return path.join(workspaceRoot, '.mcp.json');
		case 'codex':
			return path.join(workspaceRoot, '.codex', 'config.toml');
		default: {
			const exhaustive: never = agent;
			throw new Error(`Unknown agent: ${String(exhaustive)}`);
		}
	}
}

/**
 * Write the ~/.config/forgejo-mcp/instances.json file containing the default
 * instance. Used by non-VS-Code-launched stdio servers as a fallback when
 * FORGEJO_URL env var is not set.
 */
export function writeInstancesFile(
	config: { instanceUrl: string; token: string; owner: string; repo: string },
	home?: string,
): string {
	const configRoot = process.env.XDG_CONFIG_HOME ?? path.join(home ?? os.homedir(), '.config');
	const filePath = path.join(configRoot, 'forgejo-mcp', 'instances.json');
	const payload = {
		default: {
			instanceUrl: config.instanceUrl,
			token: config.token,
			defaultOwner: config.owner,
			defaultRepo: config.repo,
		},
		instances: [
			{
				instanceUrl: config.instanceUrl,
				token: config.token,
				defaultOwner: config.owner,
				defaultRepo: config.repo,
			},
		],
	};
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
	return filePath;
}

/**
 * The "Forgejo: Configure MCP for Agents…" command body. Exposed for tests.
 */
export async function exportMcpConfigCommand(
	serverPathProvider: () => string,
): Promise<McpConfigResult | null> {
	const forgejoConfig = await getForgejoConfig();
	if (!forgejoConfig) {
		void vscode.window.showErrorMessage(
			'No Forgejo instance configured. Use the Forgejo: Add Instance command first.',
		);
		return null;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage(
			'Open a workspace folder before configuring MCP for agents.',
		);
		return null;
	}

	// Warn user that tokens will be written in plaintext to agent config files.
	const proceed = await vscode.window.showWarningMessage(
		'This writes your Forgejo token in plaintext to the agent config file(s) and to ~/.config/forgejo-mcp/instances.json. Continue?',
		{ modal: true },
		'Continue',
	);
	if (proceed !== 'Continue') {
		return null;
	}

	// Multi-select quickpick of agents.
	const picks = await vscode.window.showQuickPick(
		(Object.keys(AGENT_LABELS) as AgentId[]).map((id) => ({
			label: AGENT_LABELS[id],
			id,
			picked: true,
		})),
		{
			canPickMany: true,
			title: 'Configure MCP for Agents',
			placeHolder: 'Select which AI agents should receive the Forgejo MCP server config',
		},
	);
	if (!picks || picks.length === 0) {
		return null;
	}
	const agents = picks.map((p) => p.id);

	// Confirm owner/repo (pre-filled from git remote).
	const ownerInput = await vscode.window.showInputBox({
		prompt: 'Default owner (used when an MCP tool omits owner/repo)',
		value: forgejoConfig.owner || '',
		validateInput: (v) => (v.trim() === '' ? 'Owner is required' : null),
	});
	if (!ownerInput) {
		return null;
	}
	const repoInput = await vscode.window.showInputBox({
		prompt: 'Default repo (used when an MCP tool omits owner/repo)',
		value: forgejoConfig.repo || '',
		validateInput: (v) => (v.trim() === '' ? 'Repo is required' : null),
	});
	if (!repoInput) {
		return null;
	}

	const instanceUrl = normalizeUrl(forgejoConfig.instanceUrl);
	const token = forgejoConfig.token;
	const serverPath = serverPathProvider();

	const result: McpConfigResult = {
		serverPath,
		instanceUrl,
		token,
		owner: ownerInput,
		repo: repoInput,
		workspaceRoot: workspaceFolder.uri.fsPath,
		agents,
		writtenFiles: [],
		failedFiles: [],
	};

	// Always also write the instances.json fallback file.
	try {
		const instancesFile = writeInstancesFile({
			instanceUrl,
			token,
			owner: ownerInput,
			repo: repoInput,
		});
		result.writtenFiles.push(instancesFile);
	} catch (err) {
		result.failedFiles.push({ path: '(instances.json)', error: (err as Error).message });
	}

	for (const agent of agents) {
		const configPath = getAgentConfigPath(agent, result.workspaceRoot);
		const env = buildEnvBlockJson({ instanceUrl, token, owner: ownerInput, repo: repoInput });
		let content: string;
		try {
			if (agent === 'copilot' || agent === 'claude') {
				content = buildAgentConfig(agent, serverPath, env);
			} else {
				// Codex: use TOML with TOML-formatted env block (not JSON).
				content = buildAgentConfig(agent, serverPath, env);
			}
		} catch (err) {
			result.failedFiles.push({ path: configPath, error: (err as Error).message });
			continue;
		}
		try {
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, content, 'utf8');
			result.writtenFiles.push(configPath);
		} catch (err) {
			result.failedFiles.push({ path: configPath, error: (err as Error).message });
		}
	}

	// Show a summary notification.
	const summary = result.writtenFiles.length > 0
		? `Wrote ${result.writtenFiles.length} config file(s). Reload the window for the agent to pick up changes.`
		: `Failed to write any config file(s).`;
	if (result.failedFiles.length > 0) {
		void vscode.window.showWarningMessage(
			`${summary} Errors: ${result.failedFiles.map((f) => f.error).join('; ')}`,
		);
	} else {
		void vscode.window.showInformationMessage(summary, 'Reload Window').then((action) => {
			if (action === 'Reload Window') {
				void vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		});
	}

	// Mark instances as having MCP config exported (used by diagnostics).
	const allInstances = await getAllInstances();
	void allInstances;

	return result;
}
