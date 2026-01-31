import * as vscode from 'vscode';
import { migrateToMultiInstance } from '../../utils/migration';

// Helper to mock configuration
const mockConfig = (values: Record<string, any>) => {
    const get = jest.fn((key) => values[key]);
    const update = jest.fn().mockResolvedValue(undefined);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get,
        update,
        inspect: jest.fn()
    });
    return { get, update };
};

describe('migration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('migrateToMultiInstance', () => {
        it('should do nothing if instances already exist', async () => {
            const { update } = mockConfig({
                instances: [{ id: '1', name: 'Test', instanceUrl: 'url', token: 'token' }],
                instanceUrl: 'https://legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            expect(update).not.toHaveBeenCalled();
        });

        it('should do nothing if no legacy config exists', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: '',
                token: ''
            });

            await migrateToMultiInstance();

            expect(update).not.toHaveBeenCalled();
        });

        it('should migrate legacy config to new instance format', async () => {
            const { update } = mockConfig({
                instances: undefined, // undefined or empty array
                instanceUrl: 'https://legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            expect(update).toHaveBeenCalledWith(
                'instances',
                [expect.objectContaining({
                    name: 'legacy.com',
                    instanceUrl: 'https://legacy.com',
                    token: 'legacy-token',
                    isDefault: true
                })],
                vscode.ConfigurationTarget.Global
            );
        });

        it('should handle legacy URL with trailing slash', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: 'https://legacy.com/',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            expect(update).toHaveBeenCalledWith(
                'instances',
                [expect.objectContaining({
                    instanceUrl: 'https://legacy.com'
                })],
                vscode.ConfigurationTarget.Global
            );
        });

        it('should handle legacy URL without protocol', async () => {
            const { update } = mockConfig({
                instances: [],
                instanceUrl: 'legacy.com',
                token: 'legacy-token'
            });

            await migrateToMultiInstance();

            expect(update).toHaveBeenCalledWith(
                'instances',
                [expect.objectContaining({
                    instanceUrl: 'https://legacy.com'
                })],
                vscode.ConfigurationTarget.Global
            );
        });
    });
});
