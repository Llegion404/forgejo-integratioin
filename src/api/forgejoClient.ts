import { PullRequest, PullRequestListItem } from '../models/pullRequest';
import { Issue, IssueListItem } from '../models/issue';

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

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch from Forgejo: ${error.message}`);
      }
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
   * Get list of issues for a repository
   */
  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<IssueListItem[]> {
    const endpoint = `/repos/${owner}/${repo}/issues?state=${state}&limit=50`;
    return this.request<IssueListItem[]>(endpoint);
  }

  /**
   * Get details of a specific issue
   */
  async getIssueDetails(owner: string, repo: string, number: number): Promise<Issue> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}`;
    return this.request<Issue>(endpoint);
  }

  /**
   * Test connection to Forgejo instance
   */
  async testConnection(): Promise<boolean> {
    try {
      const endpoint = '/version';
      await this.request<any>(endpoint);
      return true;
    } catch (error) {
      return false;
    }
  }
}
