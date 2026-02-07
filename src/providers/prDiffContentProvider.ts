import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';

/**
 * Custom URI scheme for PR diff virtual documents
 * Format: forgejo-pr:/{owner}/{repo}/{filepath}?ref={ref}
 *
 * The ref (branch/tag/SHA) is passed as a query parameter to avoid
 * ambiguity with branch names that contain slashes (e.g., feature/branch).
 */
export const PR_DIFF_SCHEME = 'forgejo-pr';

/**
 * Provides virtual document content for PR diffs
 */
export class PRDiffContentProvider implements vscode.TextDocumentContentProvider {
  private cache: Map<string, string> = new Map();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(this._onDidChange);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.cache.clear();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    console.log('[Forgejo] Providing content for:', uri.toString());

    // Check cache first
    const cached = this.cache.get(uri.toString());
    if (cached) {
      console.log('[Forgejo] Returning cached content');
      return cached;
    }

    // Parse URI: forgejo-pr:/{owner}/{repo}/{filepath}?ref={ref}
    const parts = uri.path.split('/').filter(p => p);
    if (parts.length < 3) {
      throw new Error('Invalid PR diff URI format');
    }

    const owner = parts[0];
    const repo = parts[1];
    const filepath = parts.slice(2).join('/');

    // Extract ref from query parameter
    const queryParams = new URLSearchParams(uri.query);
    const ref = queryParams.get('ref');
    if (!ref) {
      throw new Error('Invalid PR diff URI: missing ref query parameter');
    }

    console.log('[Forgejo] Fetching file:', { owner, repo, ref, filepath });

    try {
      const config = await getForgejoConfig();
      if (!config) {
        throw new Error('Forgejo configuration not found');
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);
      const content = await client.getFileContents(owner, repo, filepath, ref);

      // Cache the result
      this.cache.set(uri.toString(), content);

      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch file content';
      console.error('[Forgejo] Error fetching file content:', error);

      // Return error message as content
      return `// Error: ${errorMsg}\n// URI: ${uri.toString()}`;
    }
  }

  clearCache(uri?: vscode.Uri): void {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
  }

  refresh(uri: vscode.Uri): void {
    this.clearCache(uri);
    this._onDidChange.fire(uri);
  }
}

/**
 * Helper to create forgejo-pr:// URIs
 */
export function createPRFileUri(
  owner: string,
  repo: string,
  ref: string,
  filepath: string
): vscode.Uri {
  // The ref is passed as a query parameter to avoid ambiguity with
  // branch names containing slashes (e.g., feature/branch)
  const path = `/${owner}/${repo}/${filepath}`;
  return vscode.Uri.parse(`${PR_DIFF_SCHEME}:${path}?ref=${encodeURIComponent(ref)}`);
}
