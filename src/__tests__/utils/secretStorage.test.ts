import { initializeSecretStorage, getToken, setToken, deleteToken, isInitialized, _resetForTesting } from '../../utils/secretStorage';

// Mock logger
jest.mock('../../utils/logger', () => ({
	logInfo: jest.fn(),
	logWarn: jest.fn(),
	logError: jest.fn(),
	logDebug: jest.fn()
}));

/**
 * Creates a mock SecretStorage backed by a Map
 */
function createMockSecretStorage() {
	const store = new Map<string, string>();
	return {
		get: jest.fn((key: string) => Promise.resolve(store.get(key))),
		store: jest.fn((key: string, value: string) => {
			store.set(key, value);
			return Promise.resolve();
		}),
		delete: jest.fn((key: string) => {
			store.delete(key);
			return Promise.resolve();
		}),
		onDidChange: jest.fn(),
		_store: store // exposed for test assertions
	};
}

describe('secretStorage', () => {
	beforeEach(() => {
		_resetForTesting();
	});

	describe('isInitialized', () => {
		it('should return false before initialization', () => {
			expect(isInitialized()).toBe(false);
		});

		it('should return true after initialization', () => {
			const mockStorage = createMockSecretStorage();
			initializeSecretStorage(mockStorage as any);
			expect(isInitialized()).toBe(true);
		});
	});

	describe('before initialization', () => {
		it('getToken should throw', async () => {
			await expect(getToken('test-id')).rejects.toThrow('SecretStorage not initialized');
		});

		it('setToken should throw', async () => {
			await expect(setToken('test-id', 'token')).rejects.toThrow('SecretStorage not initialized');
		});

		it('deleteToken should throw', async () => {
			await expect(deleteToken('test-id')).rejects.toThrow('SecretStorage not initialized');
		});
	});

	describe('after initialization', () => {
		let mockStorage: ReturnType<typeof createMockSecretStorage>;

		beforeEach(() => {
			mockStorage = createMockSecretStorage();
			initializeSecretStorage(mockStorage as any);
		});

		describe('setToken', () => {
			it('should store token with correct key prefix', async () => {
				await setToken('instance-1', 'my-secret-token');
				expect(mockStorage.store).toHaveBeenCalledWith('forgejo-token-instance-1', 'my-secret-token');
			});
		});

		describe('getToken', () => {
			it('should return undefined for non-existent token', async () => {
				const token = await getToken('nonexistent');
				expect(token).toBeUndefined();
				expect(mockStorage.get).toHaveBeenCalledWith('forgejo-token-nonexistent');
			});

			it('should return stored token', async () => {
				await setToken('instance-1', 'my-secret-token');
				const token = await getToken('instance-1');
				expect(token).toBe('my-secret-token');
			});
		});

		describe('deleteToken', () => {
			it('should delete token with correct key prefix', async () => {
				await setToken('instance-1', 'my-secret-token');
				await deleteToken('instance-1');
				expect(mockStorage.delete).toHaveBeenCalledWith('forgejo-token-instance-1');

				const token = await getToken('instance-1');
				expect(token).toBeUndefined();
			});
		});
	});

	describe('_resetForTesting', () => {
		it('should reset initialization state', () => {
			const mockStorage = createMockSecretStorage();
			initializeSecretStorage(mockStorage as any);
			expect(isInitialized()).toBe(true);

			_resetForTesting();
			expect(isInitialized()).toBe(false);
		});
	});
});
