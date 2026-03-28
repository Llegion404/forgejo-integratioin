import * as vscode from 'vscode';
import { parseRemoteUrl, detectGitRemote, hasGitRepository } from '../../utils/gitUtils';

jest.mock('child_process');

import { execSync, spawnSync } from 'child_process';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('gitUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

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

    it('should parse SSH scp-style URL with .git suffix', () => {
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

    it('should parse SSH protocol URL with .git suffix', () => {
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

    it('should parse SSH protocol URL without git@ prefix', () => {
      const result = parseRemoteUrl('ssh://git.example.com/owner/repo.git');
      expect(result).toEqual({
        instanceUrl: 'https://git.example.com',
        owner: 'owner',
        repo: 'repo'
      });
    });

    it('should return null for empty string', () => {
      expect(parseRemoteUrl('')).toBeNull();
    });

    it('should return null for null-ish input', () => {
      expect(parseRemoteUrl(null as any)).toBeNull();
      expect(parseRemoteUrl(undefined as any)).toBeNull();
    });

    it('should return null for invalid URL', () => {
      expect(parseRemoteUrl('not-a-url')).toBeNull();
      expect(parseRemoteUrl('ftp://example.com/repo')).toBeNull();
    });

    it('should handle URL with port number in host', () => {
      const result = parseRemoteUrl('https://git.example.com:3000/owner/repo.git');
      expect(result).not.toBeNull();
      expect(result!.owner).toBe('owner');
      expect(result!.repo).toBe('repo');
    });

    it('should always return https instanceUrl even for http input', () => {
      const result = parseRemoteUrl('http://insecure.example.com/owner/repo');
      expect(result).not.toBeNull();
      expect(result!.instanceUrl).toBe('https://insecure.example.com');
    });

    it('should return the correct owner', () => {
      const result = parseRemoteUrl('https://codeberg.org/my-org/my-repo.git');
      expect(result!.owner).toBe('my-org');
    });

    it('should return repo name without .git suffix', () => {
      const result = parseRemoteUrl('https://codeberg.org/owner/my-repo.git');
      expect(result!.repo).toBe('my-repo');
    });

    it('should handle SSH URL with custom host', () => {
      const result = parseRemoteUrl('git@my-forgejo.internal:myorg/myproject.git');
      expect(result).toEqual({
        instanceUrl: 'https://my-forgejo.internal',
        owner: 'myorg',
        repo: 'myproject'
      });
    });
  });

  describe('detectGitRemote', () => {
    it('should return null when no workspace folders', async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const result = await detectGitRemote();
      expect(result).toBeNull();
    });

    it('should return parsed info when git remote exists', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any);

      const result = await detectGitRemote();
      expect(result).toEqual({
        instanceUrl: 'https://codeberg.org',
        owner: 'owner',
        repo: 'repo'
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'git', ['config', '--get', 'remote.origin.url'],
        { cwd: '/workspace/project', encoding: 'utf-8' }
      );
    });

    it('should return null when spawnSync returns non-zero', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'error', pid: 0, output: [], signal: null } as any);

      const result = await detectGitRemote();
      expect(result).toBeNull();
    });
  });

  describe('hasGitRepository', () => {
    it('should return false when no workspace folders', async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const result = await hasGitRepository();
      expect(result).toBe(false);
    });

    it('should return true when git command succeeds', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedExecSync.mockReturnValue('.git\n');

      const result = await hasGitRepository();
      expect(result).toBe(true);
    });

    it('should return false when git command throws', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: '/workspace/project' } }
      ];
      mockedExecSync.mockImplementation(() => { throw new Error('not a git repo'); });

      const result = await hasGitRepository();
      expect(result).toBe(false);
    });
  });
});
