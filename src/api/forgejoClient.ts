import { PullRequest, PullRequestListItem, PullRequestFile, FileContentsResponse, CommitStatus } from '../models/pullRequest';
import { Issue, IssueListItem } from '../models/issue';
import { ActionTasksResponse, WorkflowRun, WorkflowJobsResponse } from '../models/action';
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
        headers: response.headers && typeof response.headers.entries === 'function' 
          ? Object.fromEntries(response.headers.entries()) 
          : 'not available'
      });

      if (!response.ok) {
        let errorBody = 'Unable to read response body';
        if (typeof response.text === 'function') {
           errorBody = await response.text().catch(() => 'Unable to read response body');
        }
        
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
    // Encode each path segment individually so slashes are preserved as path separators
    const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
    const endpoint = `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
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

  /**
   * Get commit statuses for a specific SHA
   */
  async getCommitStatuses(owner: string, repo: string, sha: string): Promise<CommitStatus[]> {
    const endpoint = `/repos/${owner}/${repo}/statuses/${sha}`;
    return this.request<CommitStatus[]>(endpoint);
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    method: 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only' = 'merge',
    deleteBranchAfterMerge: boolean = false
  ): Promise<{ merged: boolean; message?: string }> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}/merge`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const body = JSON.stringify({
      Do: method,
      delete_branch_after_merge: deleteBranchAfterMerge
    });

    logDebug('Merging pull request:', { owner, repo, number, method });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Merge failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });

        if (response.status === 405) {
          throw new Error('Merge not allowed - PR may not be mergeable');
        } else if (response.status === 409) {
          throw new Error('Merge conflict - PR has conflicts that must be resolved');
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      logInfo('Pull request merged successfully:', { owner, repo, number, method });
      return { merged: true };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to merge pull request: ${String(error)}`);
    }
  }

  /**
   * Close a pull request
   */
  async closePullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const body = JSON.stringify({
      state: 'closed'
    });

    logDebug('Closing pull request:', { owner, repo, number });

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Close PR failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const pr = await response.json() as PullRequest;
      logInfo('Pull request closed successfully:', { owner, repo, number });
      return pr;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to close pull request: ${String(error)}`);
    }
  }

  /**
   * Get issue comments
   */
  async getIssueComments(owner: string, repo: string, number: number): Promise<any[]> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}/comments`;
    return this.request<any[]>(endpoint);
  }

  /**
   * Get pull request reviews
   */
  async getPullRequestReviews(owner: string, repo: string, number: number): Promise<any[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}/reviews`;
    return this.request<any[]>(endpoint);
  }

  /**
   * Get pull request commits
   */
  async getPullRequestCommits(owner: string, repo: string, number: number): Promise<any[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}/commits`;
    return this.request<any[]>(endpoint);
  }

  /**
   * Get issue timeline events
   */
  async getIssueTimeline(owner: string, repo: string, number: number): Promise<any[]> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}/timeline`;
    return this.request<any[]>(endpoint);
  }

  /**
   * Create a comment on an issue or pull request
   */
  async createComment(owner: string, repo: string, number: number, body: string): Promise<any> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}/comments`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const bodyStr = JSON.stringify({ body });

    logDebug('Creating comment:', { owner, repo, number });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Create comment failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const comment = await response.json();
      logInfo('Comment created successfully:', { owner, repo, number });
      return comment;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to create comment: ${String(error)}`);
    }
  }

  /**
   * Create a review on a pull request
   */
  async createReview(
    owner: string,
    repo: string,
    number: number,
    state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body: string
  ): Promise<any> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${number}/reviews`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const bodyStr = JSON.stringify({
      event: state,
      body
    });

    logDebug('Creating review:', { owner, repo, number, state });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Create review failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const review = await response.json();
      logInfo('Review created successfully:', { owner, repo, number, state });
      return review;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to create review: ${String(error)}`);
    }
  }

  /**
   * Update issue state (open/close)
   */
  async updateIssueState(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<Issue> {
    const endpoint = `/repos/${owner}/${repo}/issues/${number}`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const body = JSON.stringify({ state });

    logDebug('Updating issue state:', { owner, repo, number, state });

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Update issue state failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const issue = await response.json() as Issue;
      logInfo('Issue state updated successfully:', { owner, repo, number, state });
      return issue;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to update issue state: ${String(error)}`);
    }
  }

  /**
   * Create a new issue in a repository
   */
  async createIssue(owner: string, repo: string, title: string, body?: string): Promise<Issue> {
    const endpoint = `/repos/${owner}/${repo}/issues`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const payload: Record<string, string> = { title };
    if (body) {
      payload.body = body;
    }

    logDebug('Creating issue:', { owner, repo, title });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Create issue failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const issue = await response.json() as Issue;
      logInfo('Issue created successfully:', { owner, repo, number: issue.number, title: issue.title });
      return issue;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to create issue: ${String(error)}`);
    }
  }

  // ==================== Actions API Methods ====================

  /**
   * Get list of workflow runs for a repository
   */
  async getWorkflowRuns(owner: string, repo: string, status?: string): Promise<ActionTasksResponse> {
    let endpoint = `/repos/${owner}/${repo}/actions/tasks?limit=50`;
    if (status) {
      endpoint += `&status=${status}`;
    }
    logDebug('Fetching workflow runs:', { owner, repo, status });
    return this.request<ActionTasksResponse>(endpoint);
  }

  /**
   * Get details of a specific workflow run
   */
  async getWorkflowRunDetails(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    const endpoint = `/repos/${owner}/${repo}/actions/runs/${runId}`;
    logDebug('Fetching workflow run details:', { owner, repo, runId });
    return this.request<WorkflowRun>(endpoint);
  }

  /**
   * Get jobs for a specific workflow run
   */
  async getWorkflowJobs(owner: string, repo: string, runId: number): Promise<WorkflowJobsResponse> {
    const endpoint = `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    logDebug('Fetching workflow jobs:', { owner, repo, runId });
    return this.request<WorkflowJobsResponse>(endpoint);
  }

  /**
   * Fetch workflow logs from web endpoint
   * Note: Forgejo uses web endpoints for logs, not REST API
   * @param runNumber - The run_number/index_in_repo, NOT the internal id
   * @param jobIndex - Usually 0 for single-job workflows
   */
  async getWorkflowLogs(owner: string, repo: string, runNumber: number, jobIndex: number = 0): Promise<string> {
    // Logs use web endpoint: /{owner}/{repo}/actions/runs/{run_number}/jobs/{job_index}/logs
    const url = `${this.instanceUrl}/${owner}/${repo}/actions/runs/${runNumber}/jobs/${jobIndex}/logs`;

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    logDebug('Fetching workflow logs:', { owner, repo, runNumber, jobIndex, url });

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        logError('Failed to fetch workflow logs:', {
          status: response.status,
          statusText: response.statusText,
          url
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const logs = await response.text();
      logDebug('Workflow logs fetched successfully:', { length: logs.length });
      return logs;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch workflow logs: ${String(error)}`);
    }
  }

  /**
   * Re-run a workflow
   */
  async rerunWorkflow(owner: string, repo: string, runId: number): Promise<void> {
    const endpoint = `/repos/${owner}/${repo}/actions/runs/${runId}/rerun`;
    const url = `${this.instanceUrl}/api/v1${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    logDebug('Re-running workflow:', { owner, repo, runId });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        logError('Re-run workflow failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      logInfo('Workflow re-run triggered successfully:', { owner, repo, runId });
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to re-run workflow: ${String(error)}`);
    }
  }
}
