import * as vscode from 'vscode';
import { execSync } from 'child_process';

export interface GitRemoteInfo {
  instanceUrl: string;
  owner: string;
  repo: string;
}

/**
 * Detect git repository and extract remote information
 */
export async function detectGitRemote(): Promise<GitRemoteInfo | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Forgejo] No workspace folders found');
    return null;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  console.log('[Forgejo] Detecting git remote in:', workspaceRoot);

  try {
    // Get the remote URL
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    }).trim();

    console.log('[Forgejo] Found git remote URL:', remoteUrl);
    const parsed = parseRemoteUrl(remoteUrl);
    console.log('[Forgejo] Parsed remote info:', parsed);
    return parsed;
  } catch (error) {
    // Not a git repository or no remote configured
    console.log('[Forgejo] No git repository or remote found:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Parse git remote URL to extract instance URL, owner, and repo
 * Supports HTTPS and SSH formats (both scp-style and ssh:// protocol)
 */
export function parseRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
  if (!remoteUrl) {
    return null;
  }

  let match;

  // HTTPS format: https://codeberg.org/owner/repo.git
  match = remoteUrl.match(/https?:\/\/([^\/]+)\/([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  // SSH protocol format: ssh://git@host/owner/repo.git
  match = remoteUrl.match(/ssh:\/\/(?:git@)?([^\/]+)\/([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  // SSH scp-style format: git@codeberg.org:owner/repo.git
  match = remoteUrl.match(/git@([^:]+):([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  console.warn('[Forgejo] Could not parse git remote URL:', remoteUrl);
  return null;
}

/**
 * Check if current workspace has a git repository
 */
export async function hasGitRepository(): Promise<boolean> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return false;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    execSync('git rev-parse --git-dir', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    });
    return true;
  } catch (error) {
    return false;
  }
}
