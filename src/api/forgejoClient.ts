import { PullRequest, PullRequestListItem, PullRequestFile, FileContentsResponse } from '../models/pullRequest';
import { Issue, IssueListItem } from '../models/issue';
import { logDebug, logInfo, logError } from '../utils/logger';

export class ForgejoClient {
  private instanceUrl: string;
  private token: string;

  constructor(instanceUrl: string, token: string = '') {
    this.instanceUrl = instanceUrl;
    this.token = token;
  }

  /**
   * Make an authenticated request to the Forgejo API
   */
  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    logDebug('Making API request:', {
      url,
      endpoint,
      hasToken: !!this.token,
      tokenLength: this.token?.length || 0
    });

    try {
      logDebug('Calling fetch...');
      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      logDebug('Fetch completed:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('API request failed:', {
          status: response.status,
          statusText: response.statusText,
          url,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as T;
      logDebug('Response parsed successfully');
      return data;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        logError('Network error - Failed to fetch:', {
          url,
          error: error.message,
          possibleCauses: [
            'Instance URL is incorrect',
            'Instance is unreachable',
            'Network connection issue',
            'CORS or SSL certificate issue'
          ]
        });
        throw new Error(`Network error: Cannot reach ${this.instanceUrl}. ${error.message}`);
      } else if (error instanceof Error) {
        logError('Request error:', {
          message: error.message,
          name: error.name,
          url
        });
        throw new Error(`Failed to fetch from Forgejo: ${error.message}`);
      }
      logError('Unknown error:', error);
      throw error;
    }
  }

  /**
   * Get list of pull requests for a repository
   */
  async getPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<PullRequestListItem[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls?state=${state}&limit=50`;
    return this.request<PullRequestListItem[]>(endpoint);
  }

  /**
   * Get details of a specific pull request
   */
  async getPullRequestDetails(owner: string, repo: string, number: number): Promise<PullRequest> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}`;
    return this.request<PullRequest>(endpoint);
  }

  /**
   * Get list of issues for a repository (excludes pull requests)
   */
  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<IssueListItem[]> {
    const endpoint = `/repos/${owner}/${repo}/issues?state=${state}&limit=50`;
    const items = await this.request<IssueListItem[]>(endpoint);
    // Filter out pull requests - they have a pull_request field
    const issues = items.filter(item => !item.pull_request);
    console.log(`[Forgejo] Fetched ${items.length} items from issues API, filtered to ${issues.length} actual issues (excluded ${items.length - issues.length} PRs)`);
    return issues;
  }

  /**
   * Get details of a specific issue
   */
  async getIssueDetails(owner: string, repo: string, number: number): Promise<Issue> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}`;
    return this.request<Issue>(endpoint);
  }

  /**
   * Get list of files changed in a pull request
   */
  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<PullRequestFile[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}/files`;
    return this.request<PullRequestFile[]>(endpoint);
  }

  /**
   * Get file contents at a specific commit/ref
   */
  async getFileContents(owner: string, repo: string, filepath: string, ref: string): Promise<string> {
    const endpoint = `/repos/${owner}/${repo}/contents/${encodeURIComponent(filepath)}?ref=${ref}`;
    const response = await this.request<FileContentsResponse>(endpoint);

    // Forgejo returns base64 encoded content
    if (response.encoding === 'base64') {
      return Buffer.from(response.content, 'base64').toString('utf-8');
    }

    return response.content;
  }

  /**
   * Get pull request details including head and base refs
   */
  async getPullRequestRefs(owner: string, repo: string, number: number): Promise<{ base: string; head: string }> {
    const pr = await this.getPullRequestDetails(owner, repo, number);
    return {
      base: pr.base.ref,
      head: pr.head.ref
    };
  }

  /**
   * Test connection to Forgejo instance
   */
  async testConnection(): Promise<boolean> {
    logInfo('Testing connection to Forgejo instance:', this.instanceUrl);
    logDebug('Connection test details:', {
      instanceUrl: this.instanceUrl,
      hasToken: !!this.token,
      tokenPrefix: this.token ? this.token.substring(0, 8) + '...' : '(no token)',
      endpoint: '/version'
    });

    try {
      const endpoint = '/version';
      logDebug('Calling /version endpoint...');
      const version = await this.request<any>(endpoint);

      logInfo('Connection test SUCCESS:', {
        instanceUrl: this.instanceUrl,
        version: version?.version || 'unknown'
      });

      return true;
    } catch (error) {
      logError('Connection test FAILED:', {
        instanceUrl: this.instanceUrl,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.name : typeof error
      });

      // Provide helpful diagnostic information
      if (error instanceof Error) {
        if (error.message.includes('Network error')) {
          logError('Diagnosis: Cannot reach the server', {
            suggestion: 'Check if the instance URL is correct and the server is running',
            instanceUrl: this.instanceUrl
          });
        } else if (error.message.includes('401')) {
          logError('Diagnosis: Authentication failed', {
            suggestion: 'The token is invalid or has insufficient permissions'
          });
        } else if (error.message.includes('403')) {
          logError('Diagnosis: Forbidden', {
            suggestion: 'The token does not have permission to access this resource'
          });
        } else if (error.message.includes('404')) {
          logError('Diagnosis: Not found', {
            suggestion: 'The /api/v1/version endpoint does not exist. This may not be a Forgejo/Gitea instance'
          });
        } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
          logError('Diagnosis: Server error', {
            suggestion: 'The Forgejo instance is experiencing issues'
          });
        }
      }

      return false;
    }
  }
}
