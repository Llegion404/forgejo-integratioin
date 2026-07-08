import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	buildAgentConfig,
	buildEnvBlockJson,
	buildEnvBlockToml,
	getAgentConfigPath,
	writeInstancesFile,
	AgentId,
} from '../../commands/exportMcpConfig';

jest.mock('../../utils/config');
jest.mock('../../utils/instanceHelpers', () => ({
	...jest.requireActual('../../utils/instanceHelpers'),
	getAllInstances: jest.fn().mockResolvedValue([]),
	normalizeUrl: (url: string) => url.replace(/\/$/, '').replace(/^([^h])/i, 'https://$1'),
}));

const { getForgejoConfig } = require('../../utils/config') as { getForgejoConfig: jest.Mock };

describe('exportMcpConfig helpers', () => {
	describe('buildEnvBlockJson', () => {
		it('includes token when present', () => {
			const env = buildEnvBlockJson({
				instanceUrl: 'https://example.com',
				token: 'tok',
				owner: 'foo',
				repo: 'bar',
			});
			expect(env).toEqual({
				FORGEJO_URL: 'https://example.com',
				FORGEJO_TOKEN: 'tok',
				FORGEJO_OWNER: 'foo',
				FORGEJO_REPO: 'bar',
			});
		});

		it('omits token key entirely when empty', () => {
			const env = buildEnvBlockJson({
				instanceUrl: 'https://example.com',
				token: '',
				owner: 'foo',
				repo: 'bar',
			});
			expect(env).not.toHaveProperty('FORGEJO_TOKEN');
			expect(env.FORGEJO_URL).toBe('https://example.com');
		});
	});

	describe('buildEnvBlockToml', () => {
		it('emits inline-table syntax with quoted values', () => {
			const toml = buildEnvBlockToml({
				instanceUrl: 'https://example.com',
				token: 'tok',
				owner: 'foo',
				repo: 'bar',
			});
			expect(toml).toMatch(/^\{ .+ \}$/);
			expect(toml).toContain('FORGEJO_URL = "https://example.com"');
			expect(toml).toContain('FORGEJO_TOKEN = "tok"');
			expect(toml).toContain('FORGEJO_OWNER = "foo"');
			expect(toml).toContain('FORGEJO_REPO = "bar"');
		});

		it('escapes embedded double-quotes', () => {
			const toml = buildEnvBlockToml({
				instanceUrl: 'https://example.com',
				token: 'token"with"quotes',
				owner: 'foo',
				repo: 'bar',
			});
			expect(toml).toContain('FORGEJO_TOKEN = "token\\"with\\"quotes"');
		});
	});

	describe('getAgentConfigPath', () => {
		const root = '/workspace/myproject';

		it('returns .vscode/mcp.json for Copilot', () => {
			expect(getAgentConfigPath('copilot', root)).toBe(path.join(root, '.vscode', 'mcp.json'));
		});

		it('returns .mcp.json for Claude Code', () => {
			expect(getAgentConfigPath('claude', root)).toBe(path.join(root, '.mcp.json'));
		});

		it('returns .codex/config.toml for Codex', () => {
			expect(getAgentConfigPath('codex', root)).toBe(path.join(root, '.codex', 'config.toml'));
		});

		it('throws for unknown agent', () => {
			expect(() => getAgentConfigPath('totally-fake' as AgentId, root)).toThrow(/Unknown agent/);
		});
	});

	describe('buildAgentConfig', () => {
		const env = {
			FORGEJO_URL: 'https://example.com',
			FORGEJO_TOKEN: 'tok',
			FORGEJO_OWNER: 'foo',
			FORGEJO_REPO: 'bar',
		};

		it('Copilot: emits .vscode/mcp.json shape with servers.forgejo', () => {
			const cfg = buildAgentConfig('copilot', '/abs/server.js', env);
			const parsed = JSON.parse(cfg);
			expect(parsed.servers.forgejo.type).toBe('stdio');
			expect(parsed.servers.forgejo.command).toBe('node');
			expect(parsed.servers.forgejo.args).toEqual(['/abs/server.js']);
			expect(parsed.servers.forgejo.env).toEqual(env);
		});

		it('Claude Code: emits .mcp.json shape with mcpServers.forgejo', () => {
			const cfg = buildAgentConfig('claude', '/abs/server.js', env);
			const parsed = JSON.parse(cfg);
			expect(parsed.mcpServers.forgejo.type).toBe('stdio');
			expect(parsed.mcpServers.forgejo.args).toEqual(['/abs/server.js']);
			expect(parsed.mcpServers.forgejo.env).toEqual(env);
		});

		it('Codex: emits TOML with [mcp_servers.forgejo] table', () => {
			const cfg = buildAgentConfig('codex', '/abs/server.js', env);
			expect(cfg).toContain('[mcp_servers.forgejo]');
			expect(cfg).toContain('command = "node"');
			expect(cfg).toContain('args = ["/abs/server.js"]');
			expect(cfg).toContain('env = {');
			expect(cfg).toContain('FORGEJO_URL = "https://example.com"');
			expect(cfg).toContain('startup_timeout_sec = 15');
			expect(cfg).toContain('tool_timeout_sec = 60');
		});
	});

	describe('writeInstancesFile', () => {
		const TMP_DIR = path.join(os.tmpdir(), `forgejo-mcp-export-test-${Date.now()}`);
		const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

		beforeEach(() => {
			fs.mkdirSync(TMP_DIR, { recursive: true });
			process.env.XDG_CONFIG_HOME = TMP_DIR;
		});

		afterEach(() => {
			process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
			try {
				fs.rmSync(TMP_DIR, { recursive: true, force: true });
			} catch {
				// ignore
			}
		});

		it('writes instances.json with default + instances entries', () => {
			const filePath = writeInstancesFile({
				instanceUrl: 'https://example.com',
				token: 'tok',
				owner: 'foo',
				repo: 'bar',
			});
			expect(fs.existsSync(filePath)).toBe(true);
			const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			expect(parsed.default.instanceUrl).toBe('https://example.com');
			expect(parsed.default.token).toBe('tok');
			expect(parsed.default.defaultOwner).toBe('foo');
			expect(parsed.default.defaultRepo).toBe('bar');
			expect(parsed.instances).toHaveLength(1);
		});

		it('uses provided home when XDG_CONFIG_HOME unset', () => {
			delete process.env.XDG_CONFIG_HOME;
			const customHome = path.join(TMP_DIR, 'fakeHome');
			fs.mkdirSync(customHome, { recursive: true });
			const filePath = writeInstancesFile(
				{ instanceUrl: 'https://x.com', token: '', owner: 'o', repo: 'r' },
				customHome,
			);
			expect(filePath).toBe(path.join(customHome, '.config', 'forgejo-mcp', 'instances.json'));
			expect(fs.existsSync(filePath)).toBe(true);
		});
	});

	describe('exportMcpConfigCommand integration', () => {
		const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
		const TMP_DIR = path.join(os.tmpdir(), `forgejo-mcp-export-integ-${Date.now()}`);
		const ORIGINAL_HOME = process.env.HOME;

		beforeEach(() => {
			fs.mkdirSync(TMP_DIR, { recursive: true });
			process.env.XDG_CONFIG_HOME = TMP_DIR;
			process.env.HOME = TMP_DIR;
			jest.clearAllMocks();
			(vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Continue');
			(vscode.window.showQuickPick as jest.Mock).mockResolvedValue([
				{ id: 'claude' },
				{ id: 'copilot' },
			]);
			(vscode.window.showInputBox as jest.Mock)
				.mockResolvedValueOnce('test-owner')
				.mockResolvedValueOnce('test-repo');
			(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
			(vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [
				{ uri: { fsPath: TMP_DIR } } as unknown as vscode.WorkspaceFolder,
			];
			getForgejoConfig.mockResolvedValue({
				instanceUrl: 'https://git.example.com',
				token: 'integration-token',
				owner: 'auto-owner',
				repo: 'auto-repo',
			});
		});

		afterEach(() => {
			process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
			process.env.HOME = ORIGINAL_HOME;
			try {
				fs.rmSync(TMP_DIR, { recursive: true, force: true });
			} catch {
				// ignore
			}
		});

		it('returns null when no Forgejo config found', async () => {
			getForgejoConfig.mockResolvedValueOnce(null);
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const result = await exportMcpConfigCommand(() => '/server.js');
			expect(result).toBeNull();
			expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
		});

		it('returns null when no workspace folder open', async () => {
			const original = (vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders;
			(vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [];
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const result = await exportMcpConfigCommand(() => '/server.js');
			expect(result).toBeNull();
			expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
			(vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = original;
		});

		it('returns null when user cancels warning prompt', async () => {
			(vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined);
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const result = await exportMcpConfigCommand(() => '/server.js');
			expect(result).toBeNull();
		});

		it('returns null when user picks no agents', async () => {
			(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce([]);
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const result = await exportMcpConfigCommand(() => '/server.js');
			expect(result).toBeNull();
		});

		it('writes instances.json + .vscode/mcp.json + .mcp.json for selected agents', async () => {
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const serverPath = path.join(TMP_DIR, 'fake-server.js');
			fs.writeFileSync(serverPath, '', 'utf8');
			const result = await exportMcpConfigCommand(() => serverPath);
			expect(result).not.toBeNull();
			expect(result!.agents).toEqual(['claude', 'copilot']);
			expect(result!.writtenFiles).toContain(path.join(TMP_DIR, '.mcp.json'));
			expect(result!.writtenFiles).toContain(path.join(TMP_DIR, '.vscode', 'mcp.json'));
			// instances.json fallback also written
			expect(result!.writtenFiles.some((p: string) => p.includes('forgejo-mcp'))).toBe(true);

			const claudeConfig = JSON.parse(fs.readFileSync(path.join(TMP_DIR, '.mcp.json'), 'utf8'));
			expect(claudeConfig.mcpServers.forgejo.env.FORGEJO_URL).toBe('https://git.example.com');
			expect(claudeConfig.mcpServers.forgejo.env.FORGEJO_TOKEN).toBe('integration-token');
			expect(claudeConfig.mcpServers.forgejo.env.FORGEJO_OWNER).toBe('test-owner');
		});

		it('writes Codex-only config when user picks only Codex', async () => {
			(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce([{ id: 'codex' }]);
			const { exportMcpConfigCommand } = require('../../commands/exportMcpConfig');
			const result = await exportMcpConfigCommand(() => '/srv.js');
			expect(result).not.toBeNull();
			expect(result!.agents).toEqual(['codex']);
			expect(result!.writtenFiles).toContain(path.join(TMP_DIR, '.codex', 'config.toml'));
			expect(result!.writtenFiles).not.toContain(path.join(TMP_DIR, '.mcp.json'));
		});
	});
});
