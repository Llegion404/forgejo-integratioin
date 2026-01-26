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
  console.log('[Forgejo] Getting configuration...');
  const config = vscode.workspace.getConfiguration('forgejo');

  let instanceUrl = config.get<string>('instanceUrl') || '';
  let token = config.get<string>('token') || '';
  const autoDetect = config.get<boolean>('autoDetectFromRemote', true);

  console.log('[Forgejo] Settings:', {
    instanceUrl: instanceUrl || '(not set)',
    hasToken: !!token,
    autoDetect
  });

  let gitInfo: GitRemoteInfo | null = null;

  // Try to auto-detect from git remote if enabled
  if (autoDetect) {
    gitInfo = await detectGitRemote();

    if (gitInfo) {
      // Use git remote URL if instance URL is not configured
      if (!instanceUrl) {
        instanceUrl = gitInfo.instanceUrl;
        console.log('[Forgejo] Using auto-detected instance URL:', instanceUrl);
      }
    }
  }

  // Check if we have the minimum required configuration
  if (!instanceUrl) {
    console.log('[Forgejo] No instance URL configured');
    return null;
  }

  // If we don't have git info yet, we can't determine owner/repo
  if (!gitInfo) {
    gitInfo = await detectGitRemote();
  }

  if (!gitInfo) {
    console.log('[Forgejo] Could not determine owner/repo from git remote');
    return null;
  }

  const finalConfig = {
    instanceUrl: instanceUrl.replace(/\/$/, ''), // Remove trailing slash
    token,
    owner: gitInfo.owner,
    repo: gitInfo.repo
  };

  console.log('[Forgejo] Final configuration:', finalConfig);
  return finalConfig;
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
