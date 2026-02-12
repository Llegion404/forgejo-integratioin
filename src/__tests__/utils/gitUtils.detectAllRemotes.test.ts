import * as vscode from 'vscode';
import { detectAllGitRemotes } from '../../utils/gitUtils';

jest.mock('child_process');

import { execSync } from 'child_process';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('detectAllGitRemotes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  it('should return empty map when no workspace folders', async () => {
    (vscode.workspace as any).workspaceFolders = undefined;
    const result = await detectAllGitRemotes();
    expect(result.size).toBe(0);
  });

  it('should return empty map when no remotes found', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockReturnValue('');

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(0);
  });

  it('should parse single remote', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'git remote') { return 'origin\n'; }
      if (cmdStr.includes('remote.origin.url')) { return 'https://codeberg.org/owner/repo.git\n'; }
      return '';
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.get('origin')).toEqual({
      instanceUrl: 'https://codeberg.org',
      owner: 'owner',
      repo: 'repo'
    });
  });

  it('should parse multiple remotes', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'git remote') { return 'origin\nupstream\n'; }
      if (cmdStr.includes('remote.origin.url')) { return 'https://codeberg.org/owner/repo.git\n'; }
      if (cmdStr.includes('remote.upstream.url')) { return 'git@github.com:upstream-owner/repo.git\n'; }
      return '';
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(2);
    expect(result.get('origin')).toEqual({
      instanceUrl: 'https://codeberg.org',
      owner: 'owner',
      repo: 'repo'
    });
    expect(result.get('upstream')).toEqual({
      instanceUrl: 'https://github.com',
      owner: 'upstream-owner',
      repo: 'repo'
    });
  });

  it('should skip remotes with unparseable URLs', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'git remote') { return 'origin\nbad-remote\n'; }
      if (cmdStr.includes('remote.origin.url')) { return 'https://codeberg.org/owner/repo.git\n'; }
      if (cmdStr.includes('remote.bad-remote.url')) { return 'not-a-valid-url\n'; }
      return '';
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.has('origin')).toBe(true);
    expect(result.has('bad-remote')).toBe(false);
  });

  it('should handle error when getting individual remote URL', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'git remote') { return 'origin\nbroken\n'; }
      if (cmdStr.includes('remote.origin.url')) { return 'https://codeberg.org/owner/repo.git\n'; }
      if (cmdStr.includes('remote.broken.url')) { throw new Error('failed'); }
      return '';
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.has('origin')).toBe(true);
  });

  it('should handle error when listing remotes', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation(() => { throw new Error('not a git repo'); });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(0);
  });

  it('should handle remotes with whitespace in names', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'git remote') { return '  origin  \n  upstream  \n'; }
      if (cmdStr.includes('remote.origin.url')) { return 'https://codeberg.org/owner/repo.git\n'; }
      if (cmdStr.includes('remote.upstream.url')) { return 'https://git.example.com/other/repo.git\n'; }
      return '';
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(2);
  });
});
