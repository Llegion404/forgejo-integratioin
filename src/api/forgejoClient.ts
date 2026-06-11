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

  async updatePullRequestState(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<PullRequest> {
    return this.updatePullRequest(owner, repo, number, { state });
  }

  async togglePullRequestDraft(owner: string, repo: string, number: number, draft: boolean): Promise<PullRequest> {
    return this.rawRequest('PATCH', `/repos/${owner}/${repo}/pulls/${number}`, { draft });
  }

  async deleteComment(owner: string, repo: string, commentId: number): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/comments/${commentId}`);
  }

  async cancelWorkflowRun(owner: string, repo: string, runId: number): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/actions/runs/${runId}/cancel`);
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

  // Label management
  async listRepoLabels(owner: string, repo: string): Promise<{ id: number; name: string; color: string }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/labels`);
  }

  async addIssueLabel(owner: string, repo: string, number: number, labels: string[]): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/issues/${number}/labels`, { labels });
  }

  async removeIssueLabel(owner: string, repo: string, number: number, label: string): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
  }

  async addPullRequestLabel(owner: string, repo: string, number: number, labels: string[]): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${number}/labels`, { labels });
  }

  async removePullRequestLabel(owner: string, repo: string, number: number, label: string): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${number}/labels/${encodeURIComponent(label)}`);
  }

  // Assignee management
  async listRepoAssignees(owner: string, repo: string): Promise<{ login: string; avatar_url: string }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/assignees`);
  }

  async addIssueAssignees(owner: string, repo: string, number: number, assignees: string[]): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/issues/${number}/assignees`, { assignees });
  }

  async removeIssueAssignees(owner: string, repo: string, number: number, assignees: string[]): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/${number}/assignees`, { assignees });
  }

  // Reviewer management
  async addPullRequestReviewers(owner: string, repo: string, number: number, reviewers: string[]): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, { reviewers });
  }

  async removePullRequestReviewers(owner: string, repo: string, number: number, reviewers: string[]): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, { reviewers });
  }

  // Lock/unlock
  async lockIssue(owner: string, repo: string, number: number, reason?: string): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/issues/${number}/lock`, { reason: reason || '' });
  }

  async unlockIssue(owner: string, repo: string, number: number): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/issues/${number}/lock`);
  }

  async lockPullRequest(owner: string, repo: string, number: number, reason?: string): Promise<unknown> {
    return this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${number}/lock`, { reason: reason || '' });
  }

  async unlockPullRequest(owner: string, repo: string, number: number): Promise<unknown> {
    return this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${number}/lock`);
  }

  // Milestone management
  async listMilestones(owner: string, repo: string): Promise<{ id: number; title: string; state: string; open_issues: number; closed_issues: number }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/milestones`);
  }

  // PR management
  async addPRLabels(owner: string, repo: string, prIndex: number, labels: string[]): Promise<void> {
    await this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${prIndex}/labels`, { labels });
  }

  async removePRLabel(owner: string, repo: string, prIndex: number, label: string): Promise<void> {
    await this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${prIndex}/labels/${encodeURIComponent(label)}`);
  }

  async addPRAssignees(owner: string, repo: string, prIndex: number, assignees: string[]): Promise<void> {
    await this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${prIndex}/assignees`, { assignees });
  }

  async removePRAssignees(owner: string, repo: string, prIndex: number, assignees: string[]): Promise<void> {
    await this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${prIndex}/assignees`, { assignees });
  }

  async requestPRReview(owner: string, repo: string, prIndex: number, reviewer: string): Promise<void> {
    await this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${prIndex}/requested_reviewers`, { reviewers: [reviewer] });
  }

  async removePRReview(owner: string, repo: string, prIndex: number, reviewer: string): Promise<void> {
    await this.rawRequest('DELETE', `/repos/${owner}/${repo}/pulls/${prIndex}/requested_reviewers`, { reviewers: [reviewer] });
  }

  // Release management
  async deleteRelease(owner: string, repo: string, releaseId: number): Promise<void> {
    await this.rawRequest('DELETE', `/repos/${owner}/${repo}/releases/${releaseId}`);
  }
}
