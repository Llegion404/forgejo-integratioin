import { parseRemoteUrl, GitRemoteInfo } from '../../utils/gitUtils';

describe('gitUtils', () => {
    describe('parseRemoteUrl', () => {
        it('should parse HTTPS URL with .git suffix', () => {
            const result = parseRemoteUrl('https://codeberg.org/owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse HTTPS URL without .git suffix', () => {
            const result = parseRemoteUrl('https://codeberg.org/owner/repo');
            expect(result).toEqual({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse HTTP URL', () => {
            const result = parseRemoteUrl('http://git.example.com/owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://git.example.com',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse SSH scp-style URL', () => {
            const result = parseRemoteUrl('git@codeberg.org:owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse SSH scp-style URL without .git suffix', () => {
            const result = parseRemoteUrl('git@codeberg.org:owner/repo');
            expect(result).toEqual({
                instanceUrl: 'https://codeberg.org',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse SSH protocol URL', () => {
            const result = parseRemoteUrl('ssh://git@git.example.com/owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://git.example.com',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should parse SSH protocol URL without .git suffix', () => {
            const result = parseRemoteUrl('ssh://git@git.example.com/owner/repo');
            expect(result).toEqual({
                instanceUrl: 'https://git.example.com',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should return null for empty string', () => {
            const result = parseRemoteUrl('');
            expect(result).toBeNull();
        });

        it('should return null for unrecognized URL format', () => {
            const result = parseRemoteUrl('not-a-valid-url');
            expect(result).toBeNull();
        });

        it('should handle HTTPS URL with port number', () => {
            const result = parseRemoteUrl('https://git.example.com:3000/owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://git.example.com:3000',
                owner: 'owner',
                repo: 'repo'
            });
        });

        it('should handle SSH URL with custom host', () => {
            const result = parseRemoteUrl('git@my-forgejo.internal:myorg/myproject.git');
            expect(result).toEqual({
                instanceUrl: 'https://my-forgejo.internal',
                owner: 'myorg',
                repo: 'myproject'
            });
        });

        it('should handle SSH protocol URL without git@ prefix', () => {
            const result = parseRemoteUrl('ssh://git.example.com/owner/repo.git');
            expect(result).toEqual({
                instanceUrl: 'https://git.example.com',
                owner: 'owner',
                repo: 'repo'
            });
        });
    });
});
