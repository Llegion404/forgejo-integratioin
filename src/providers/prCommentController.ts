import * as vscode from 'vscode';
import { ForgejoClient } from '../api/forgejoClient';
import { getForgejoConfig } from '../utils/config';
import { PRContext, PullReview, ReviewComment } from '../models/comment';
import { PR_DIFF_SCHEME } from './prDiffContentProvider';
import { pendingReviewManager } from './pendingReviewManager';

/**
 * Manages inline PR comments using the VS Code Comment Controller API.
 *
 * When a PR diff is opened via the `forgejo-pr:` scheme, this controller:
 * - Shows the gutter "+" icon for adding new comments
 * - Loads existing review comments from the Forgejo API
 * - Creates new inline comments via the Forgejo review API
 */
export class ForgejoCommentController implements vscode.Disposable {
  private controller: vscode.CommentController;
  private prContextMap = new Map<string, PRContext>();
  private threads = new Map<string, vscode.CommentThread[]>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.controller = vscode.comments.createCommentController(
      'forgejo-pr-comments',
      'Forgejo PR Comments'
    );

    // Allow commenting on forgejo-pr: virtual documents (the read-only "before"
    // side of a diff) and on local workspace files that have a registered PR
    // context (the editable "after" side of a diff).
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document: vscode.TextDocument): vscode.Range[] => {
        if (!this.isPRDocument(document.uri)) {
          return [];
        }
        const lineCount = document.lineCount;
        return [new vscode.Range(0, 0, lineCount - 1, 0)];
      }
    };

    this.disposables.push(this.controller);

    // Listen for document opens to load existing comments
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isPRDocument(doc.uri)) {
          void this.loadCommentsForDocument(doc);
        }
      })
    );

    // Clean up threads when documents close
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const docThreads = this.threads.get(key);
        if (docThreads) {
          docThreads.forEach(t => t.dispose());
          this.threads.delete(key);
        }
      })
    );

    console.log('[Forgejo] Comment controller initialized');
  }

  /**
   * Register PR context for a URI so we know which PR a document belongs to.
   */
  registerPRContext(uri: vscode.Uri, context: PRContext): void {
    this.prContextMap.set(uri.toString(), context);
  }

  /**
   * Whether a URI is a PR document: a forgejo-pr: virtual doc, or any local
   * file that has a registered PR context (the editable side of a diff).
   */
  private isPRDocument(uri: vscode.Uri): boolean {
    return uri.scheme === PR_DIFF_SCHEME || this.prContextMap.has(uri.toString());
  }

  /**
   * Parse a forgejo-pr: URI to extract the ref used.
   * URI format: forgejo-pr:/{owner}/{repo}/{base64url_ref}/{filepath}
   */
  private parseUri(uri: vscode.Uri): { owner: string; repo: string; ref: string; filePath: string } | undefined {
    const parts = uri.path.split('/').filter(p => p);
    if (parts.length < 4) {
      return undefined;
    }

    const owner = parts[0];
    const repo = parts[1];
    const encodedRef = parts[2];
    const filePath = decodeURIComponent(parts.slice(3).join('/'));
    const ref = Buffer.from(encodedRef, 'base64url').toString();

    return { owner, repo, ref, filePath };
  }

  /**
   * Determine whether this URI represents the base (old) or head (new) side of the diff.
   */
  private isHeadSide(uri: vscode.Uri): boolean {
    const ctx = this.prContextMap.get(uri.toString());
    if (!ctx) {
      return true;
    }

    const parsed = this.parseUri(uri);
    if (parsed) {
      return parsed.ref === ctx.headRef;
    }

    // Local workspace files are the editable "after" (head) side of the diff.
    return true;
  }

  /**
   * Load existing review comments for a document from the Forgejo API.
   */
  async loadCommentsForDocument(document: vscode.TextDocument): Promise<void> {
    const uriKey = document.uri.toString();
    const ctx = this.prContextMap.get(uriKey);
    if (!ctx) {
      return;
    }

    try {
      const config = await getForgejoConfig();
      if (!config) {
        return;
      }

      const client = new ForgejoClient(config.instanceUrl, config.token);

      // Fetch all reviews for this PR
      const reviews: PullReview[] = await client.getPullRequestReviews(
        ctx.owner,
        ctx.repo,
        ctx.prNumber
      );

      // For each review that has comments, fetch them
      const allComments: ReviewComment[] = [];
      for (const review of reviews) {
        if (review.comments_count && review.comments_count > 0) {
          const comments: ReviewComment[] = await client.getReviewComments(
            ctx.owner,
            ctx.repo,
            ctx.prNumber,
            review.id
          );
          allComments.push(...comments);
        }
      }

      // Filter comments for the current file path
      const fileComments = allComments.filter(c => c.path === ctx.filePath);

      if (fileComments.length === 0) {
        return;
      }

      // Clean up any existing threads for this document
      const existingThreads = this.threads.get(uriKey);
      if (existingThreads) {
        existingThreads.forEach(t => t.dispose());
      }

      // Group comments by line number
      const commentsByLine = new Map<number, ReviewComment[]>();
      for (const comment of fileComments) {
        const line = comment.line;
        if (line <= 0) {
          continue;
        }
        const existing = commentsByLine.get(line) ?? [];
        existing.push(comment);
        commentsByLine.set(line, existing);
      }

      // Create comment threads
      const newThreads: vscode.CommentThread[] = [];
      for (const [line, comments] of commentsByLine) {
        // Forgejo lines are 1-indexed, VS Code is 0-indexed
        const range = new vscode.Range(line - 1, 0, line - 1, 0);

        const vscodeComments: vscode.Comment[] = comments.map(c => ({
          body: new vscode.MarkdownString(c.body),
          author: { name: c.user.login },
          mode: vscode.CommentMode.Preview
        }));

        const thread = this.controller.createCommentThread(
          document.uri,
          range,
          vscodeComments
        );
        thread.canReply = true;
        thread.label = `Review comment`;
        newThreads.push(thread);
      }

      this.threads.set(uriKey, newThreads);
      console.log(`[Forgejo] Loaded ${fileComments.length} review comments for ${ctx.filePath}`);
    } catch (error) {
      console.error('[Forgejo] Error loading review comments:', error);
    }
  }

  /**
   * Handle creating a new inline comment (called when user submits from gutter).
   *
   * Forgejo-style workflow:
   * - First comment: prompts user to "Start a Review" or "Comment directly"
   * - If "Start Review": all pending comments batch into a single review on submit
   * - If "Comment directly": submits immediately as a single-comment review
   * - Subsequent comments during pending review: add to pending automatically
   */
  async handleCreateComment(reply: vscode.CommentReply): Promise<void> {
    const uri = reply.thread.uri;
    const ctx = this.prContextMap.get(uri.toString());

    if (!ctx) {
      void vscode.window.showErrorMessage('Cannot determine PR context for this file. Please re-open the diff from the Pull Requests view.');
      return;
    }

    const config = await getForgejoConfig();
    if (!config) {
      void vscode.window.showErrorMessage('Forgejo configuration not found.');
      return;
    }

    if (!config.token) {
      void vscode.window.showErrorMessage('A Forgejo token is required to create comments. Please configure your token first.');
      return;
    }

    // VS Code lines are 0-indexed, Forgejo API is 1-indexed
    const range = reply.thread.range;
    if (!range) {
      void vscode.window.showErrorMessage('Cannot determine line position for this comment.');
      return;
    }
    const line = range.start.line + 1;

    // Determine if this is on the head (new) or base (old) side
    const isHead = this.isHeadSide(uri);

    // If a pending review is already active, add to pending
    if (pendingReviewManager.hasPendingReview(ctx.owner, ctx.repo, ctx.prNumber)) {
      this._addToPendingReview(reply, ctx, line, isHead);
      return;
    }

    // First comment — prompt user: Start Review or Comment Directly
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(git-pull-request) Start a Review', description: 'Batch this and future comments into a single review' },
        { label: '$(comment) Comment directly', description: 'Submit this comment immediately' },
        { label: '$(circle-slash) Cancel', description: 'Discard this comment' },
      ],
      { placeHolder: 'How would you like to comment?' }
    );

    if (!choice || choice.label.includes('Cancel')) {
      return;
    }

    if (choice.label.includes('Start a Review')) {
      // Add to pending review
      pendingReviewManager.startOrGetReview(ctx.owner, ctx.repo, ctx.prNumber);
      this._addToPendingReview(reply, ctx, line, isHead);
      void vscode.window.showInformationMessage(
        'Review started. Add more comments or click the review status bar item to submit.'
      );
      return;
    }

    // Comment directly — submit immediately
    try {
      const client = new ForgejoClient(config.instanceUrl, config.token);

      const commentPayload: {
        body: string;
        path: string;
        new_position: number;
        old_position?: number;
      } = {
        body: reply.text,
        path: ctx.filePath,
        new_position: isHead ? line : 0,
      };

      if (!isHead) {
        commentPayload.old_position = line;
      }

      await client.createReviewWithComments(
        ctx.owner,
        ctx.repo,
        ctx.prNumber,
        { event: 'COMMENT', comments: [commentPayload] }
      );

      const newComment: vscode.Comment = {
        body: new vscode.MarkdownString(reply.text),
        author: { name: 'You' },
        mode: vscode.CommentMode.Preview,
      };

      reply.thread.comments = [...reply.thread.comments, newComment];

      console.log(`[Forgejo] Created inline comment on ${ctx.filePath}:${line}`);
    } catch (error) {
      console.error('[Forgejo] Error creating inline comment:', error);
      void vscode.window.showErrorMessage(
        `Failed to create comment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private _addToPendingReview(reply: vscode.CommentReply, ctx: PRContext, line: number, isHead: boolean): void {
    pendingReviewManager.startOrGetReview(ctx.owner, ctx.repo, ctx.prNumber);
    pendingReviewManager.addComment(ctx.owner, ctx.repo, ctx.prNumber, ctx.filePath, line, reply.text, isHead);

    const pendingComment: vscode.Comment = {
      body: new vscode.MarkdownString(`_Pending review comment:_\n\n${reply.text}`),
      author: { name: 'You (pending)' },
      mode: vscode.CommentMode.Preview,
    };

    reply.thread.comments = [...reply.thread.comments, pendingComment];
    reply.thread.label = `Pending (review)`;
  }

  dispose(): void {
    // Dispose all threads
    for (const docThreads of this.threads.values()) {
      docThreads.forEach(t => t.dispose());
    }
    this.threads.clear();
    this.prContextMap.clear();

    this.disposables.forEach(d => void d.dispose());
    this.disposables = [];
  }
}
