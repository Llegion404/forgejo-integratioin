import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';

export interface GitRemoteInfo {
  instanceUrl: string;
  owner: string;
  repo: string;
}

/**
 * Detect git repository and extract remote information
 * @param remoteName Optional remote name to use instead of 'origin'
 */
export function detectGitRemote(remoteName?: string): GitRemoteInfo | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Forgejo] No workspace folders found');
    return null;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const remote = remoteName ?? 'origin';
  console.log('[Forgejo] Detecting git remote in:', workspaceRoot, 'using remote:', remote);

  try {
    // Get the remote URL (use spawnSync to avoid shell injection via remote name)
    const result = spawnSync('git', ['config', '--get', `remote.${remote}.url`], {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    });
    if (result.status !== 0) {
      console.log('[Forgejo] Could not get remote URL for:', remote);
      return null;
    }
    const remoteUrl = result.stdout.trim();

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
 * Detect all git remotes and extract their information
 * Returns a Map of remote name to GitRemoteInfo
 */
export function detectAllGitRemotes(): Map<string, GitRemoteInfo> {
  const result = new Map<string, GitRemoteInfo>();
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Forgejo] No workspace folders found');
    return result;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  console.log('[Forgejo] Detecting all git remotes in:', workspaceRoot);

  try {
    // List all remote names
    const remotesOutput = execSync('git remote', {
      cwd: workspaceRoot,
      encoding: 'utf-8'
    }).trim();

    if (!remotesOutput) {
      console.log('[Forgejo] No git remotes found');
      return result;
    }

    const remoteNames = remotesOutput.split('\n').map(name => name.trim()).filter(name => name.length > 0);
    console.log('[Forgejo] Found git remotes:', remoteNames);

    for (const name of remoteNames) {
      try {
        const remoteResult = spawnSync('git', ['config', '--get', `remote.${name}.url`], {
          cwd: workspaceRoot,
          encoding: 'utf-8'
        });
        if (remoteResult.status !== 0) {
          console.log(`[Forgejo] Could not get URL for remote '${name}'`);
          continue;
        }
        const remoteUrl = remoteResult.stdout.trim();

        const parsed = parseRemoteUrl(remoteUrl);
        if (parsed) {
          result.set(name, parsed);
          console.log(`[Forgejo] Parsed remote '${name}':`, parsed);
        } else {
          console.log(`[Forgejo] Could not parse remote '${name}' URL:`, remoteUrl);
        }
      } catch (error) {
        console.log(`[Forgejo] Error getting URL for remote '${name}':`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.log('[Forgejo] Error listing git remotes:', error instanceof Error ? error.message : error);
  }

  return result;
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
  match = remoteUrl.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  // SSH protocol format: ssh://git@host/owner/repo.git
  match = remoteUrl.match(/ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) {
    const [, host, owner, repo] = match;
    return {
      instanceUrl: `https://${host}`,
      owner,
      repo: repo.replace(/\.git$/, '')
    };
  }

  // SSH scp-style format: git@codeberg.org:owner/repo.git
  match = remoteUrl.match(/git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
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
export function hasGitRepository(): boolean {
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
