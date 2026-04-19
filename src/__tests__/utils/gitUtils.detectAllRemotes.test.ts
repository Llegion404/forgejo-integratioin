import * as vscode from 'vscode';
import { detectAllGitRemotes } from '../../utils/gitUtils';

jest.mock('child_process');

import { execSync, spawnSync } from 'child_process';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

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
    mockedExecSync.mockReturnValue('origin\n');
    mockedSpawnSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      const argStr = argsArr.join(' ');
      if (argStr.includes('remote.origin.url')) {
        return { status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      return { status: 1, stdout: '', stderr: 'not found', pid: 0, output: [], signal: null } as any;
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.get('origin')).toEqual({
      instanceUrl: 'https://codeberg.org',
      remoteHost: 'codeberg.org',
      owner: 'owner',
      repo: 'repo'
    });
  });

  it('should parse multiple remotes', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockReturnValue('origin\nupstream\n');
    mockedSpawnSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      const argStr = argsArr.join(' ');
      if (argStr.includes('remote.origin.url')) {
        return { status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      if (argStr.includes('remote.upstream.url')) {
        return { status: 0, stdout: 'git@github.com:upstream-owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      return { status: 1, stdout: '', stderr: 'not found', pid: 0, output: [], signal: null } as any;
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(2);
    expect(result.get('origin')).toEqual({
      instanceUrl: 'https://codeberg.org',
      remoteHost: 'codeberg.org',
      owner: 'owner',
      repo: 'repo'
    });
    expect(result.get('upstream')).toEqual({
      remoteHost: 'github.com',
      owner: 'upstream-owner',
      repo: 'repo'
    });
  });

  it('should skip remotes with unparseable URLs', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockReturnValue('origin\nbad-remote\n');
    mockedSpawnSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      const argStr = argsArr.join(' ');
      if (argStr.includes('remote.origin.url')) {
        return { status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      if (argStr.includes('remote.bad-remote.url')) {
        return { status: 0, stdout: 'not-a-valid-url\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      return { status: 1, stdout: '', stderr: 'not found', pid: 0, output: [], signal: null } as any;
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.has('origin')).toBe(true);
    expect(result.has('bad-remote')).toBe(false);
  });

  it('should handle non-zero exit when getting individual remote URL', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockReturnValue('origin\nbroken\n');
    mockedSpawnSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      const argStr = argsArr.join(' ');
      if (argStr.includes('remote.origin.url')) {
        return { status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      if (argStr.includes('remote.broken.url')) {
        return { status: 1, stdout: '', stderr: 'failed', pid: 0, output: [], signal: null } as any;
      }
      return { status: 1, stdout: '', stderr: 'not found', pid: 0, output: [], signal: null } as any;
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
    mockedExecSync.mockReturnValue('  origin  \n  upstream  \n');
    mockedSpawnSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      const argStr = argsArr.join(' ');
      if (argStr.includes('remote.origin.url')) {
        return { status: 0, stdout: 'https://codeberg.org/owner/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      if (argStr.includes('remote.upstream.url')) {
        return { status: 0, stdout: 'https://git.example.com/other/repo.git\n', stderr: '', pid: 0, output: [], signal: null } as any;
      }
      return { status: 1, stdout: '', stderr: 'not found', pid: 0, output: [], signal: null } as any;
    });

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(2);
  });
});
