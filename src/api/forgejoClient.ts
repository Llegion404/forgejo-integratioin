/**
 * VS Code extension wrapper around the forgejo-ts client library.
 *
 * Provides backward-compatible constructor (instanceUrl, token) and
 * legacy method names so existing call sites don't need to change.
 */
import {
  ForgejoClient as BaseClient,
  type PullRequest,
  type PullRequestListItem,
  type Issue,
  type IssueListItem,
  type ActionTasksResponse,
  type WorkflowRun,
} from 'forgejo-ts';
import { vscodeLogger } from '../utils/forgejoLoggerAdapter';

export class ForgejoClient extends BaseClient {
  constructor(instanceUrl: string, token = '') {
    super({ instanceUrl, token, logger: vscodeLogger });
  }

  // Legacy method aliases for backward compatibility

  async getPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<PullRequestListItem[]> {
    return this.listPullRequests(owner, repo, state);
  }

  async getPullRequestDetails(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.getPullRequest(owner, repo, number);
  }

  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all'): Promise<IssueListItem[]> {
    return this.listIssues(owner, repo, state);
  }

  async getIssueDetails(owner: string, repo: string, number: number): Promise<Issue> {
    return this.getIssue(owner, repo, number);
  }

  async getWorkflowRuns(owner: string, repo: string, status?: string): Promise<ActionTasksResponse> {
    return this.listWorkflowRuns(owner, repo, status ? { status } : undefined);
  }

  async getWorkflowRunDetails(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    return this.getWorkflowRun(owner, repo, runId);
  }

  async updateIssueState(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<Issue> {
    return this.updateIssue(owner, repo, number, { state });
  }

  async updatePullRequestBody(owner: string, repo: string, number: number, body: string): Promise<PullRequest> {
    return this.updatePullRequest(owner, repo, number, { body });
  }

  async updateIssueBody(owner: string, repo: string, number: number, body: string): Promise<Issue> {
    return this.updateIssue(owner, repo, number, { body });
  }

  // Reaction API methods
  async getCommentReactions(owner: string, repo: string, commentId: number): Promise<{ id: number; user: { login: string; avatar_url?: string }; reaction: string }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`);
  }

  async addCommentReaction(owner: string, repo: string, commentId: number, reaction: string): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`, { reaction });
  }

  async deleteCommentReaction(owner: string, repo: string, commentId: number, reaction: string): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`, { reaction });
  }

  async getIssueReactions(owner: string, repo: string, issueId: number): Promise<{ id: number; user: { login: string; avatar_url?: string }; reaction: string }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/issues/${issueId}/reactions`);
  }

  async addIssueReaction(owner: string, repo: string, issueId: number, reaction: string): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/issues/${issueId}/reactions`, { reaction });
  }

  async deleteIssueReaction(owner: string, repo: string, issueId: number, reaction: string): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/${issueId}/reactions`, { reaction });
  }

  // Comment editing
  async updateComment(owner: string, repo: string, commentId: number, body: string): Promise<unknown> {
    return this.rawRequest('PATCH', `/repos/${owner}/${repo}/issues/comments/${commentId}`, { body });
  }
}
