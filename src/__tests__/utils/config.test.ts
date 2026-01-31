import * as vscode from 'vscode';
import { getForgejoConfig } from '../../utils/config';
import { detectGitRemote } from '../../utils/gitUtils';

// Mock gitUtils
jest.mock('../../utils/gitUtils');

// Helper to mock configuration
const mockConfig = (instances: any[]) => {
    const get = jest.fn((key) => {
        if (key === 'instances') return instances;
        return undefined;
    });
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get,
        update: jest.fn(),
        inspect: jest.fn()
    });
};

describe('config', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getForgejoConfig', () => {
        const mockInstances = [
            {
                id: '1',
                name: 'Codeberg',
                instanceUrl: 'https://codeberg.org',
                token: 'token1',
                isDefault: true
            },
            {
                id: '2',
                name: 'Work',
                instanceUrl: 'https://git.company.com',
                token: 'token2'
            }
        ];

        it('should return null if no instances configured', async () => {
            mockConfig([]);
            (detectGitRemote as jest.Mock).mockResolvedValue({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();
            expect(config).toBeNull();
        });

        it('should return matched instance from git remote', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockResolvedValue({
                instanceUrl: 'https://git.company.com',
                owner: 'myorg',
                repo: 'myrepo'
            });

            const config = await getForgejoConfig();
            
            expect(config).toEqual({
                instanceUrl: 'https://git.company.com',
                token: 'token2',
                owner: 'myorg',
                repo: 'myrepo',
                instanceId: '2',
                matchConfidence: 'exact'
            });
        });

        it('should fallback to default instance if no match found', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockResolvedValue({
                instanceUrl: 'https://github.com', // Not in instances
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://codeberg.org', // Default instance
                token: 'token1',
                owner: 'owner',
                repo: 'repo',
                instanceId: '1',
                matchConfidence: 'default'
            });
        });

        it('should fallback to first instance if no default and no match', async () => {
            const noDefaultInstances = [
                { ...mockInstances[1], isDefault: false }, // Work
                { ...mockInstances[0], isDefault: false }  // Codeberg
            ];
            mockConfig(noDefaultInstances);
            
            (detectGitRemote as jest.Mock).mockResolvedValue({
                instanceUrl: 'https://github.com',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config).toEqual({
                instanceUrl: 'https://git.company.com', // First instance
                token: 'token2',
                owner: 'owner',
                repo: 'repo',
                instanceId: '2',
                matchConfidence: 'first'
            });
        });

        it('should return null if git remote detection fails', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockResolvedValue(null);

            const config = await getForgejoConfig();

            expect(config).toBeNull();
        });

        it('should handle git remote with different path structure', async () => {
            mockConfig(mockInstances);
            (detectGitRemote as jest.Mock).mockResolvedValue({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });

            const config = await getForgejoConfig();

            expect(config?.instanceId).toBe('1');
            expect(config?.matchConfidence).toBe('exact');
        });
    });
});
