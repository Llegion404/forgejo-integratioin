import * as vscode from 'vscode';
import { detectGitRemote, GitRemoteInfo } from './gitUtils';

export interface ForgejoConfig {
  instanceUrl: string;
  token: string;
  owner: string;
  repo: string;
}

/**
 * Get Forgejo configuration from VS Code settings
 */
export async function getForgejoConfig(): Promise<ForgejoConfig | null> {
  const config = vscode.workspace.getConfiguration('forgejo');

  let instanceUrl = config.get<string>('instanceUrl') || '';
  let token = config.get<string>('token') || '';
  const autoDetect = config.get<boolean>('autoDetectFromRemote', true);

  let gitInfo: GitRemoteInfo | null = null;

  // Try to auto-detect from git remote if enabled
  if (autoDetect) {
    gitInfo = await detectGitRemote();

    if (gitInfo) {
      // Use git remote URL if instance URL is not configured
      if (!instanceUrl) {
        instanceUrl = gitInfo.instanceUrl;
      }
    }
  }

  // Check if we have the minimum required configuration
  if (!instanceUrl) {
    return null;
  }

  // If we don't have git info yet, we can't determine owner/repo
  if (!gitInfo) {
    gitInfo = await detectGitRemote();
  }

  if (!gitInfo) {
    return null;
  }

  return {
    instanceUrl: instanceUrl.replace(/\/$/, ''), // Remove trailing slash
    token,
    owner: gitInfo.owner,
    repo: gitInfo.repo
  };
}

/**
 * Set instance URL in configuration
 */
export async function setInstanceUrl(url: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update('instanceUrl', url, vscode.ConfigurationTarget.Global);
}

/**
 * Set authentication token in configuration
 */
export async function setAuthToken(token: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  await config.update('token', token, vscode.ConfigurationTarget.Global);
}
