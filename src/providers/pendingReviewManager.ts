import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { logDebug } from '../utils/logger';

interface PendingComment {
  id: string;
  path: string;
  line: number;
  body: string;
  isHead: boolean;
  timestamp: number;
}

interface PendingReviewState {
  owner: string;
  repo: string;
  prNumber: number;
  comments: PendingComment[];
  reviewState: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null;
  reviewBody: string;
  statusBarItem: vscode.StatusBarItem;
}

export class PendingReviewManager implements vscode.Disposable {
  private reviews = new Map<string, PendingReviewState>();
  private disposables: vscode.Disposable[] = [];
  private _sharedStatusBar: vscode.StatusBarItem | undefined;

  private getPRKey(owner: string, repo: string, prNumber: number): string {
    return `${owner}/${repo}/pulls/${prNumber}`;
  }

  hasPendingReview(owner: string, repo: string, prNumber: number): boolean {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    return !!review && review.comments.length > 0;
  }

  startOrGetReview(owner: string, repo: string, prNumber: number): void {
    const key = this.getPRKey(owner, repo, prNumber);
    if (!this.reviews.has(key)) {
      const state: PendingReviewState = {
        owner,
        repo,
        prNumber,
        comments: [],
        reviewState: null,
        reviewBody: '',
        statusBarItem: vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
      };
      state.statusBarItem.command = 'forgejo.managePendingReview';
      state.statusBarItem.tooltip = 'Manage pending review';
      this.disposables.push(state.statusBarItem);
      this.reviews.set(key, state);
    }
    this.updateStatusBar(key);
  }

  addComment(owner: string, repo: string, prNumber: number, path: string, line: number, body: string, isHead: boolean): string {
    const key = this.getPRKey(owner, repo, prNumber);
    this.startOrGetReview(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (!review) return '';

    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    review.comments.push({ id, path, line, body, isHead, timestamp: Date.now() });
    this.updateStatusBar(key);
    logDebug('Pending review comment added:', { key, path, line, total: review.comments.length });
    return id;
  }

  removeComment(owner: string, repo: string, prNumber: number, commentId: string): boolean {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (!review) return false;

    const index = review.comments.findIndex(c => c.id === commentId);
    if (index === -1) return false;

    review.comments.splice(index, 1);
    this.updateStatusBar(key);
    logDebug('Pending review comment removed:', { key, commentId });
    return true;
  }

  getComments(owner: string, repo: string, prNumber: number): PendingComment[] {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    return review?.comments ?? [];
  }

  setReviewState(owner: string, repo: string, prNumber: number, state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null): void {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (review) {
      review.reviewState = state;
      this.updateStatusBar(key);
    }
  }

  setReviewBody(owner: string, repo: string, prNumber: number, body: string): void {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (review) {
      review.reviewBody = body;
    }
  }

  async submitReview(owner: string, repo: string, prNumber: number): Promise<boolean> {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (!review || review.comments.length === 0) {
      void vscode.window.showWarningMessage('No pending comments to submit.');
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const state = review.reviewState || 'COMMENT';
    const body = review.reviewBody || '';

    try {
      const config = await getForgejoConfig();
      if (!config) throw new Error('No config');

      const client = new ForgejoClient(config.instanceUrl, config.token);

      const commentsPayload = review.comments.map(c => ({
        body: c.body,
        path: c.path,
        new_position: c.isHead ? c.line : 0,
        ...(c.isHead ? {} : { old_position: c.line }),
      }));

      await client.createReviewWithComments(owner, repo, prNumber, {
        event: state,
        body: body || undefined,
        comments: commentsPayload,
      });

      void vscode.window.showInformationMessage(`Review submitted: ${state.toLowerCase().replace(/_/g, ' ')}`);
      this.cancelReview(owner, repo, prNumber);
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to submit review: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  cancelReview(owner: string, repo: string, prNumber: number): void {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (review) {
      review.statusBarItem.dispose();
      this.reviews.delete(key);
      logDebug('Pending review cancelled:', { key });
    }
  }

  getReviewInfo(owner: string, repo: string, prNumber: number): { state: string | null; commentCount: number } | null {
    const key = this.getPRKey(owner, repo, prNumber);
    const review = this.reviews.get(key);
    if (!review) return null;
    return { state: review.reviewState, commentCount: review.comments.length };
  }

  private updateStatusBar(key: string): void {
    const review = this.reviews.get(key);
    if (!review) return;

    const count = review.comments.length;
    if (count > 0) {
      const stateLabel = review.reviewState ? review.reviewState.toLowerCase().replace(/_/g, ' ') : 'pending';
      review.statusBarItem.text = `$(git-pull-request) Review: ${stateLabel} (${count})`;
      review.statusBarItem.tooltip = `Pending review: ${count} comment${count > 1 ? 's' : ''}\nClick to manage`;
      review.statusBarItem.show();
    } else {
      review.statusBarItem.hide();
    }
  }

  dispose(): void {
    for (const review of this.reviews.values()) {
      review.statusBarItem.dispose();
    }
    this.reviews.clear();
    this.disposables.forEach(d => { d.dispose(); });
    this.disposables = [];
  }
}

export const pendingReviewManager = new PendingReviewManager();
