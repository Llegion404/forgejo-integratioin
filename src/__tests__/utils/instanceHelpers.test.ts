import {
	generateUUID,
	normalizeUrl,
	findBestInstanceMatch,
	getDefaultInstanceName,
	getConnectionStatus
} from '../../utils/instanceHelpers';
import { ForgejoInstance } from '../../models/instance';

describe('instanceHelpers', () => {
	describe('generateUUID', () => {
		it('should generate a valid UUID v4', () => {
			const uuid = generateUUID();
			expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		});

		it('should generate unique UUIDs', () => {
			const uuid1 = generateUUID();
			const uuid2 = generateUUID();
			expect(uuid1).not.toBe(uuid2);
		});
	});

	describe('normalizeUrl', () => {
		it('should add https:// to URL without protocol', () => {
			expect(normalizeUrl('codeberg.org')).toBe('https://codeberg.org');
		});

		it('should preserve existing https:// protocol', () => {
			expect(normalizeUrl('https://codeberg.org')).toBe('https://codeberg.org');
		});

		it('should preserve existing http:// protocol', () => {
			expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
		});

		it('should remove trailing slash', () => {
			expect(normalizeUrl('https://codeberg.org/')).toBe('https://codeberg.org');
		});

		it('should handle URL with path', () => {
			expect(normalizeUrl('https://codeberg.org/some/path/')).toBe('https://codeberg.org/some/path');
		});

		it('should trim whitespace', () => {
			expect(normalizeUrl('  https://codeberg.org  ')).toBe('https://codeberg.org');
		});
	});

	describe('findBestInstanceMatch', () => {
		const instances: ForgejoInstance[] = [
			{
				id: '1',
				name: 'Codeberg',
				instanceUrl: 'https://codeberg.org',
				token: 'token1'
			},
			{
				id: '2',
				name: 'Work',
				instanceUrl: 'https://git.company.com',
				token: 'token2'
			},
			{
				id: '3',
				name: 'Local',
				instanceUrl: 'http://localhost:3000',
				token: 'token3'
			}
		];

		it('should return null when remoteUrl is null', () => {
			const result = findBestInstanceMatch(instances, null);
			expect(result).toBeNull();
		});

		it('should return null when instances array is empty', () => {
			const result = findBestInstanceMatch([], 'https://codeberg.org');
			expect(result).toBeNull();
		});

		it('should find exact match', () => {
			const result = findBestInstanceMatch(instances, 'https://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should find exact match ignoring trailing slash', () => {
			const result = findBestInstanceMatch(instances, 'https://codeberg.org/');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});

		it('should find domain match for http vs https', () => {
			const result = findBestInstanceMatch(instances, 'http://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('domain');
		});

		it('should find exact match even with different paths', () => {
			// normalizeUrl will strip the path for matching
			const result = findBestInstanceMatch(instances, 'https://git.company.com/some/path');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('2');
			// This should be domain match since the paths differ
			expect(result?.confidence).toBe('domain');
		});

		it('should return null for no match', () => {
			const result = findBestInstanceMatch(instances, 'https://github.com');
			expect(result).toBeNull();
		});

		it('should handle localhost URLs', () => {
			const result = findBestInstanceMatch(instances, 'http://localhost:3000');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('3');
			expect(result?.confidence).toBe('exact');
		});

		it('should prefer exact match over domain match', () => {
			const testInstances: ForgejoInstance[] = [
				{
					id: '1',
					name: 'HTTPS',
					instanceUrl: 'https://codeberg.org',
					token: 'token1'
				},
				{
					id: '2',
					name: 'HTTP',
					instanceUrl: 'http://codeberg.org',
					token: 'token2'
				}
			];

			const result = findBestInstanceMatch(testInstances, 'https://codeberg.org');
			expect(result).not.toBeNull();
			expect(result?.instance.id).toBe('1');
			expect(result?.confidence).toBe('exact');
		});
	});

	describe('getDefaultInstanceName', () => {
		it('should return known instance name for Codeberg', () => {
			expect(getDefaultInstanceName('https://codeberg.org')).toBe('Codeberg');
		});

		it('should return known instance name for Gitea', () => {
			expect(getDefaultInstanceName('https://gitea.com')).toBe('Gitea');
		});

		it('should return known instance name for Disroot', () => {
			expect(getDefaultInstanceName('https://git.disroot.org')).toBe('Disroot');
		});

		it('should return hostname for unknown instances', () => {
			expect(getDefaultInstanceName('https://git.example.com')).toBe('git.example.com');
		});

		it('should handle URL without protocol', () => {
			expect(getDefaultInstanceName('git.example.com')).toBe('Default Instance');
		});

		it('should return default for invalid URLs', () => {
			expect(getDefaultInstanceName('not-a-url')).toBe('Default Instance');
		});
	});

	describe('getConnectionStatus', () => {
		it('should return "Not tested" when no test result', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token'
			};

			expect(getConnectionStatus(instance)).toBe('$(question) Not tested');
		});

		it('should return success status with time ago', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 5 * 60 * 1000 // 5 minutes ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('$(check) Connected');
			expect(status).toContain('5m ago');
		});

		it('should return failure status with error', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token',
				lastConnectionTest: {
					success: false,
					timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
					error: 'Network error'
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('$(x) Failed');
			expect(status).toContain('Network error');
		});

		it('should show "just now" for very recent tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 30 * 1000 // 30 seconds ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('just now');
		});

		it('should show hours for older tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('2h ago');
		});

		it('should show days for very old tests', () => {
			const instance: ForgejoInstance = {
				id: '1',
				name: 'Test',
				instanceUrl: 'https://codeberg.org',
				token: 'token',
				lastConnectionTest: {
					success: true,
					timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 // 3 days ago
				}
			};

			const status = getConnectionStatus(instance);
			expect(status).toContain('3d ago');
		});
	});
});
