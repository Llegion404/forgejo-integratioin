import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';

export interface GitRemoteInfo {
  instanceUrl: string;
  owner: string;
  repo: string;
}

function maskRemoteUrlForLogging(remoteUrl: string): string {
  const trimmedRemoteUrl = remoteUrl.trim();

  try {
    const parsedUrl = new URL(trimmedRemoteUrl);
    if (parsedUrl.username || parsedUrl.password) {
      parsedUrl.username = parsedUrl.username ? '***' : '';
      parsedUrl.password = parsedUrl.password ? '***' : '';
    }
    return parsedUrl.toString();
  } catch {
    return trimmedRemoteUrl
      .replace(/(https?:\/\/)([^/@\s]+)@/i, '$1***@')
      .replace(/(ssh:\/\/)([^/@\s]+)@/i, '$1***@');
  }
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

    console.log('[Forgejo] Found git remote URL:', maskRemoteUrlForLogging(remoteUrl));
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
          console.log(`[Forgejo] Could not parse remote '${name}' URL:`, maskRemoteUrlForLogging(remoteUrl));
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

function decodeRemotePathSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded.includes('/')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseRemotePath(pathname: string): Pick<GitRemoteInfo, 'owner' | 'repo'> | null {
  const segments = pathname
    .split('/')
    .filter(segment => segment.length > 0);

  if (segments.length !== 2) {
    return null;
  }

  const owner = decodeRemotePathSegment(segments[0]);
  const repoSegment = decodeRemotePathSegment(segments[1]);

  if (!owner || !repoSegment) {
    return null;
  }

  const repo = repoSegment.endsWith('.git')
    ? repoSegment.slice(0, -4)
    : repoSegment;

  if (!repo) {
    return null;
  }

  return { owner, repo };
}

function parseStandardRemoteUrl(parsedUrl: URL): GitRemoteInfo | null {
  if (!['http:', 'https:', 'ssh:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    return null;
  }

  const pathInfo = parseRemotePath(parsedUrl.pathname);
  if (!pathInfo) {
    return null;
  }

  const instanceHost = parsedUrl.protocol === 'ssh:'
    ? parsedUrl.hostname
    : parsedUrl.host;

  return {
    instanceUrl: `https://${instanceHost}`,
    ...pathInfo
  };
}

function parseScpStyleRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
  const atIndex = remoteUrl.indexOf('@');
  const colonIndex = remoteUrl.indexOf(':', atIndex + 1);

  if (atIndex <= 0 || colonIndex <= atIndex + 1) {
    return null;
  }

  const host = remoteUrl.slice(atIndex + 1, colonIndex).trim();
  const path = remoteUrl.slice(colonIndex + 1).trim();

  if (!host || !path) {
    return null;
  }

  const pathInfo = parseRemotePath(path);
  if (!pathInfo) {
    return null;
  }

  return {
    instanceUrl: `https://${host}`,
    ...pathInfo
  };
}

/**
 * Parse git remote URL to extract instance URL, owner, and repo
 * Uses the URL parser for HTTP(S) and ssh:// remotes, with a fallback parser for scp-style SSH remotes.
 */
export function parseRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmedRemoteUrl = remoteUrl.trim();
  if (!trimmedRemoteUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedRemoteUrl);
    const parsedRemote = parseStandardRemoteUrl(parsedUrl);
    if (parsedRemote) {
      return parsedRemote;
    }
  } catch {
    // Fall back to scp-style parsing below.
  }

  const scpStyleRemote = parseScpStyleRemoteUrl(trimmedRemoteUrl);
  if (scpStyleRemote) {
    return scpStyleRemote;
  }

  console.warn('[Forgejo] Could not parse git remote URL:', maskRemoteUrlForLogging(remoteUrl));
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
