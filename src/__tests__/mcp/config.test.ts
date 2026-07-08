import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	resolveConfig,
	getConfigFilePath,
	_snapshotEnvForTesting,
	_resetEnvForTesting,
	McpInstanceConfig,
} from '../../mcp/config';

describe('mcp config resolution', () => {
	const TMP_DIR = path.join(os.tmpdir(), `forgejo-mcp-test-${Date.now()}`);
	const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
	const ORIGINAL_HOME = process.env.HOME;
	let envSnapshot: Record<string, string | undefined>;

	beforeEach(() => {
		envSnapshot = _snapshotEnvForTesting();
		_resetEnvForTesting({});
		fs.mkdirSync(TMP_DIR, { recursive: true });
		process.env.XDG_CONFIG_HOME = TMP_DIR;
		process.env.HOME = TMP_DIR;
	});

	afterEach(() => {
		_resetEnvForTesting(envSnapshot);
		process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
		process.env.HOME = ORIGINAL_HOME;
		try {
			fs.rmSync(TMP_DIR, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	describe('getConfigFilePath', () => {
		it('uses $XDG_CONFIG_HOME when set', () => {
			const p = getConfigFilePath();
			expect(p).toBe(path.join(TMP_DIR, 'forgejo-mcp', 'instances.json'));
		});

		it('falls back to ~/.config when XDG_CONFIG_HOME unset', () => {
			delete process.env.XDG_CONFIG_HOME;
			// config.ts prefers process.env.HOME over os.homedir() so tests can
			// override the location by setting HOME.
			const p = getConfigFilePath();
			const expected = path.join(TMP_DIR, '.config', 'forgejo-mcp', 'instances.json');
			expect(p).toBe(expected);
		});
	});

	describe('resolveConfig', () => {
		it('returns env-var config when FORGEJO_URL set', () => {
			process.env.FORGEJO_URL = 'https://codeberg.org';
			process.env.FORGEJO_TOKEN = 'tok';
			process.env.FORGEJO_OWNER = 'foo';
			process.env.FORGEJO_REPO = 'bar';
			const cfg = resolveConfig();
			expect(cfg).toEqual({
				instanceUrl: 'https://codeberg.org',
				token: 'tok',
				defaultOwner: 'foo',
				defaultRepo: 'bar',
			} as McpInstanceConfig);
		});

		it('returns empty token when FORGEJO_TOKEN unset but URL set', () => {
			process.env.FORGEJO_URL = 'https://example.com';
			const cfg = resolveConfig();
			expect(cfg.instanceUrl).toBe('https://example.com');
			expect(cfg.token).toBe('');
			expect(cfg.defaultOwner).toBeUndefined();
			expect(cfg.defaultRepo).toBeUndefined();
		});

		it('falls back to instances.json file when no env vars', () => {
			const cfgPath = getConfigFilePath();
			fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
			fs.writeFileSync(
				cfgPath,
				JSON.stringify({
					default: {
						instanceUrl: 'https://file.example.com',
						token: 'file-tok',
						defaultOwner: 'file-owner',
						defaultRepo: 'file-repo',
					},
				}),
				'utf8',
			);
			const cfg = resolveConfig();
			expect(cfg.instanceUrl).toBe('https://file.example.com');
			expect(cfg.token).toBe('file-tok');
			expect(cfg.defaultOwner).toBe('file-owner');
		});

		it('env vars take precedence over file', () => {
			const cfgPath = getConfigFilePath();
			fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
			fs.writeFileSync(
				cfgPath,
				JSON.stringify({
					default: { instanceUrl: 'https://file.example.com', token: 'file-tok' },
				}),
				'utf8',
			);
			process.env.FORGEJO_URL = 'https://env.example.com';
			const cfg = resolveConfig();
			expect(cfg.instanceUrl).toBe('https://env.example.com');
		});

		it('throws when neither env vars nor file present', () => {
			expect(() => resolveConfig()).toThrow(/No Forgejo configuration found/);
		});

		it('throws when file is malformed JSON', () => {
			const cfgPath = getConfigFilePath();
			fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
			fs.writeFileSync(cfgPath, 'not-json', 'utf8');
			expect(() => resolveConfig()).toThrow(/not valid JSON/);
		});

		it('throws when file is missing default entry', () => {
			const cfgPath = getConfigFilePath();
			fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
			fs.writeFileSync(cfgPath, JSON.stringify({ foo: 'bar' }), 'utf8');
			expect(() => resolveConfig()).toThrow(/missing a 'default' object/);
		});
	});
});
