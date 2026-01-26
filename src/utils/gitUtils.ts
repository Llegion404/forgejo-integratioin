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
    return null;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  try {
    // Get the remote URL
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    }).trim();

    return parseRemoteUrl(remoteUrl);
  } catch (error) {
    // Not a git repository or no remote configured
    return null;
  }
}

/**
 * Parse git remote URL to extract instance URL, owner, and repo
 * Supports both HTTPS and SSH formats
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

  // SSH format: git@codeberg.org:owner/repo.git
  match = remoteUrl.match(/git@([^:]+):([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

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
