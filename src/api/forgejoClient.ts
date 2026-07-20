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

  async mergePullRequestWithMessage(
    owner: string,
    repo: string,
    index: number,
    method: 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only',
    mergeTitle: string,
    mergeMessage: string,
    deleteBranchAfterMerge: boolean = false
  ): Promise<void> {
    await this.rawRequest('POST', `/repos/${owner}/${repo}/pulls/${index}/merge`, {
      Do: method,
      MergeTitleField: mergeTitle,
      MergeMessageField: mergeMessage,
      delete_branch_after_merge: deleteBranchAfterMerge,
    });
  }

  // Release management
  async deleteRelease(owner: string, repo: string, releaseId: number): Promise<void> {
    await this.rawRequest('DELETE', `/repos/${owner}/${repo}/releases/${releaseId}`);
  }

  async updateRelease(
    owner: string,
    repo: string,
    releaseId: number,
    fields: { name?: string; body?: string; prerelease?: boolean; is_latest?: boolean; tag_name?: string; target_commitish?: string }
  ): Promise<unknown> {
    return this.rawRequest('PATCH', `/repos/${owner}/${repo}/releases/${releaseId}`, fields);
  }

  // ===== B4 features: repo metadata, notifications, branches, commits =====

  async getRepo(owner: string, repo: string): Promise<{
    name: string; full_name: string; description: string; html_url: string;
    stars: number; forks_count: number; watchers_count: number; open_issues_count: number;
    language: string; license?: { name: string }; default_branch: string;
    created_at: string; updated_at: string; owner: { login: string; avatar_url?: string };
  }> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}`);
  }

  async listRepoLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/languages`);
  }

  async listRepoContributors(owner: string, repo: string): Promise<{ login: string; contributions: number; avatar_url?: string }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/contributors`);
  }

  async getReadme(owner: string, repo: string): Promise<{ name: string; content: string; encoding: string; html_url: string } | null> {
    try {
      return await this.rawRequest('GET', `/repos/${owner}/${repo}/readme`);
    } catch {
      return null;
    }
  }

  async listRepoTopFiles(owner: string, repo: string, ref?: string): Promise<{ name: string; path: string; type: string; size: number }[]> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return this.rawRequest('GET', `/repos/${owner}/${repo}/contents${query}`);
  }

  async listNotifications(opts?: { all?: boolean; status?: 'read' | 'unread'; subject_type?: string; page?: number; limit?: number }): Promise<NotificationThread[]> {
    const params = new URLSearchParams();
    if (opts?.all) params.set('all', 'true');
    if (opts?.status) params.set('status', opts.status);
    if (opts?.subject_type) params.set('subject-type', opts.subject_type);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.limit) params.set('limit', String(opts.limit));
    const q = params.toString();
    return this.rawRequest('GET', `/notifications${q ? `?${q}` : ''}`);
  }

  async markNotificationRead(threadId: string): Promise<void> {
    await this.rawRequest('PATCH', `/notifications/threads/${threadId}`);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.rawRequest('PUT', `/notifications`);
  }

  async listRepoBranches(owner: string, repo: string, page = 1, limit = 30): Promise<{ name: string; commit: { id: string; message?: string }; protected: boolean }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/branches?page=${page}&limit=${limit}`);
  }

  async getBranch(owner: string, repo: string, branch: string): Promise<{ name: string; commit: { id: string; message?: string }; protected: boolean }> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  }

  async listRepoCommits(owner: string, repo: string, opts?: { sha?: string; path?: string; page?: number; limit?: number }): Promise<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string; avatar_url?: string } }[]> {
    const params = new URLSearchParams();
    if (opts?.sha) params.set('sha', opts.sha);
    if (opts?.path) params.set('path', opts.path);
    params.set('page', String(opts?.page ?? 1));
    params.set('limit', String(opts?.limit ?? 30));
    return this.rawRequest('GET', `/repos/${owner}/${repo}/commits?${params.toString()}`);
  }

  async compareCommits(owner: string, repo: string, base: string, head: string): Promise<{
    commits: { sha: string; commit: { message: string } }[];
    files: { filename: string; status: string; additions: number; deletions: number; changes: number }[];
    total_commits: number;
  }> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  }

  async listRepoCollaborators(owner: string, repo: string): Promise<{ login: string; avatar_url?: string; permissions?: { admin: boolean; push: boolean; pull: boolean } }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/collaborators`);
  }

  async listRepoWebhooks(owner: string, repo: string): Promise<{ id: number; url: string; events: string[]; active: boolean; config?: { url: string; content_type: string } }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/hooks`);
  }

  async listRepoDeployKeys(owner: string, repo: string): Promise<{ id: number; title: string; key: string; read_only: boolean }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/keys`);
  }

  async listBranchProtections(owner: string, repo: string): Promise<{ rule_name: string; approvals_whitelist_teams?: string[]; enable_push?: boolean }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/branch_protections`);
  }

  async listWorkflowArtifacts(owner: string, repo: string, runId: number): Promise<{ id: number; name: string; size_in_bytes: number; url: string; archive_download_url: string; expired: boolean }[]> {
    return this.rawRequest('GET', `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`);
  }

  async rerunFailedJobs(owner: string, repo: string, runId: number): Promise<void> {
    await this.rawRequest('POST', `/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`);
  }
}

export interface NotificationThread {
  id: string;
  unread: boolean;
  pinned: boolean;
  subject: {
    title: string;
    type: string;
    state?: string;
    url?: string;
    latest_comment_url?: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string; avatar_url?: string };
    html_url: string;
  };
  updated_at: string;
  url: string;
}
