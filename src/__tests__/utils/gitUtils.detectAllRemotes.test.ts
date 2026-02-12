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
    // First call: git remote
    mockedExecSync.mockReturnValueOnce('origin\n');
    // Second call: git config --get remote.origin.url
    mockedExecSync.mockReturnValueOnce('https://codeberg.org/owner/repo.git\n');

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
    mockedExecSync.mockReturnValueOnce('origin\nupstream\n');
    mockedExecSync.mockReturnValueOnce('https://codeberg.org/owner/repo.git\n');
    mockedExecSync.mockReturnValueOnce('git@github.com:upstream-owner/repo.git\n');

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
    mockedExecSync.mockReturnValueOnce('origin\nbad-remote\n');
    mockedExecSync.mockReturnValueOnce('https://codeberg.org/owner/repo.git\n');
    mockedExecSync.mockReturnValueOnce('not-a-valid-url\n');

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(1);
    expect(result.has('origin')).toBe(true);
    expect(result.has('bad-remote')).toBe(false);
  });

  it('should handle error when getting individual remote URL', async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/project' } }
    ];
    mockedExecSync.mockReturnValueOnce('origin\nbroken\n');
    mockedExecSync.mockReturnValueOnce('https://codeberg.org/owner/repo.git\n');
    mockedExecSync.mockImplementationOnce(() => { throw new Error('failed'); });

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
    mockedExecSync.mockReturnValueOnce('  origin  \n  upstream  \n');
    mockedExecSync.mockReturnValueOnce('https://codeberg.org/owner/repo.git\n');
    mockedExecSync.mockReturnValueOnce('https://git.example.com/other/repo.git\n');

    const result = await detectAllGitRemotes();
    expect(result.size).toBe(2);
  });
});
