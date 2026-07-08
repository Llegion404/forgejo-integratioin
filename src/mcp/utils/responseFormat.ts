/**
 * Pure helpers for shrinking raw Forgejo API responses into agent-friendly,
 * size-bounded shapes. The raw tools (list_pull_request_files, etc.) return
 * the untouched SDK objects, which can be huge on large PRs (every `patch`
 * string is embedded inline, comment bodies run unbounded, commit lists
 * reach hundreds). These helpers drop noise (avatar URLs, full SHAs when a
 * short form suffices, multi-line commit bodies) and cap counts/lengths,
 * always signalling via `truncated` flags so the caller knows when to drill
 * in with the raw tools.
 *
 * Mirrors the `statusDedup.ts` contract: type-only `forgejo-ts` imports, no
 * `vscode` import, fully unit-testable. Kept separate from `statusDedup.ts`
 * (which is dedicated to CI status collapsing) so each module has one job.
 */

import type {
	PullRequest,
	PullRequestCommit,
	PullRequestFile,
	PullRequestReview,
} from 'forgejo-ts';
import type { IssueComment } from 'forgejo-ts';

/** A user reference reduced to the only field an agent needs. */
export interface CompactUser {
	login: string;
}

/** Result of truncating a long string. `text` always fits within `maxLen`. */
export interface TruncatedText {
	text: string;
	/** True when the original was longer than `maxLen`. */
	truncated: boolean;
	/** Original character length before truncation. */
	original_length: number;
}

/**
 * Truncate a string to `maxLen` characters (including the truncation marker
 * when applied). Returns a marker object so the caller can flag the
 * truncation in its own envelope. `null`/`undefined` inputs are normalised
 * to an empty string.
 */
export function truncateText(value: string | null | undefined, maxLen: number): TruncatedText {
	const text = value ?? '';
	const originalLength = text.length;
	if (originalLength <= maxLen) {
		return { text, truncated: false, original_length: originalLength };
	}
	const marker = `… (truncated, ${originalLength - maxLen} more chars)`;
	// Reserve room for the marker inside the cap.
	const slice = text.slice(0, Math.max(0, maxLen - marker.length));
	return { text: slice + marker, truncated: true, original_length: originalLength };
}

/**
 * Truncate a unified-diff `patch` string to at most `maxLines` lines while
 * preserving every `@@ ... @@` hunk header line (so the agent can still see
 * which files/regions changed). Changed body lines after each hunk header
 * count toward the limit; headers don't. Appends a trailing marker line
 * when content was dropped.
 *
 * `maxLines <= 0` returns `{ text: '', truncated: originalLength > 0 }`.
 */
export function truncatePatch(patch: string | null | undefined, maxLines: number): TruncatedText {
	const text = patch ?? '';
	const originalLength = text.length;
	if (maxLines <= 0) {
		return { text: '', truncated: text.length > 0, original_length: originalLength };
	}
	const lines = text.split('\n');
	if (lines.length <= maxLines) {
		return { text, truncated: false, original_length: originalLength };
	}
	const kept: string[] = [];
	let bodyCount = 0;
	let reachedLimit = false;
	for (const line of lines) {
		if (line.startsWith('@@')) {
			// Hunk headers never count toward the cap — always kept.
			kept.push(line);
			continue;
		}
		if (bodyCount >= maxLines) {
			reachedLimit = true;
			continue;
		}
		kept.push(line);
		bodyCount++;
	}
	const dropped = lines.length - kept.length;
	if (dropped > 0) {
		kept.push(`… (${dropped} more lines)`);
	}
	return { text: kept.join('\n'), truncated: reachedLimit || dropped > 0, original_length: originalLength };
}

/** Shorten a 40/64-char SHA to its leading `len` hex chars (default 7). */
export function shortSha(sha: string, len = 7): string {
	return sha ? sha.slice(0, len) : '';
}

/** Reduce a User to `{ login }` (drops avatar_url — pure noise for agents). */
export function compactUser(u: { login?: string | null } | null | undefined): CompactUser | null {
	if (!u?.login) {
		return null;
	}
	return { login: u.login };
}

/** First line of a commit message (subject); trailing whitespace trimmed. */
export function commitSubject(message: string | undefined): string {
	if (!message) {
		return '';
	}
	const firstLine = message.split('\n', 1)[0];
	return firstLine.trim();
}

/** Total additions across all files (sum of `file.additions`). */
export function totalAdditions(files: { additions?: number }[]): number {
	return files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
}

/** Total deletions across all files (sum of `file.deletions`). */
export function totalDeletions(files: { deletions?: number }[]): number {
	return files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Section summarizers — each returns a bounded, schema-stable sub-object.
// ---------------------------------------------------------------------------

/** Options controlling the `description` section of a PR summary. */
export interface DescriptionOptions {
	/** Maximum characters for the PR body. Default 2000. */
	maxBodyLength?: number;
}

/** Compact description block: core PR metadata + bounded body. */
export interface PrDescriptionSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	draft: boolean;
	merged: boolean;
	mergeable: boolean;
	base_ref: string;
	head_ref: string;
	head_sha: string;
	author: CompactUser | null;
	created_at: string;
	updated_at: string;
	labels: { name: string }[];
	body: TruncatedText;
}

/**
 * Summarise the top-level PR object: bounded body, short keys, no avatar URLs.
 * Always returns metadata even when the body is enormous.
 */
export function summarizePrDescription(
	pr: PullRequest,
	opts: DescriptionOptions = {},
): PrDescriptionSummary {
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	return {
		number: pr.number,
		title: pr.title,
		state: pr.state,
		draft: pr.draft,
		merged: pr.merged,
		mergeable: pr.mergeable,
		base_ref: pr.base.ref,
		head_ref: pr.head.ref,
		head_sha: pr.head.sha,
		author: compactUser(pr.user),
		created_at: pr.created_at,
		updated_at: pr.updated_at,
		labels: pr.labels.map((l) => ({ name: l.name })),
		body: truncateText(pr.body, maxBodyLength),
	};
}

/** Options controlling the `commits` section of a PR summary. */
export interface CommitsOptions {
	/** Maximum number of commit items to return. Default 50. */
	maxItems?: number;
}

/** Compact commit item: short SHA, subject only, author + date. */
export interface CommitItem {
	sha: string;
	short_sha: string;
	subject: string;
	author: CompactUser | null;
	commit_author: string;
	date: string;
}

/** Commits section: bounded list with truncation flag + totals. */
export interface CommitsSummary {
	total: number;
	returned: number;
	truncated: boolean;
	items: CommitItem[];
}

/**
 * Summarise the PR's commit list: short SHAs, first line of each commit
 * message only, capped to `maxItems`. The agent can call
 * `list_pull_request_commits` for full messages or `get_file_contents`
 * with a SHA to inspect a single commit's tree.
 */
export function summarizeCommits(
	commits: PullRequestCommit[],
	opts: CommitsOptions = {},
): CommitsSummary {
	const maxItems = opts.maxItems ?? DEFAULT_MAX_COMMITS;
	const total = commits.length;
	const sliced = commits.slice(0, maxItems);
	return {
		total,
		returned: sliced.length,
		truncated: total > sliced.length,
		items: sliced.map((c) => ({
			sha: c.sha,
			short_sha: shortSha(c.sha),
			subject: commitSubject(c.commit.message),
			author: compactUser(c.author),
			commit_author: c.commit.author.name,
			date: c.commit.author.date,
		})),
	};
}

/** Options controlling the `conversation` section of a PR summary. */
export interface ConversationOptions {
	/** Maximum number of comment items to return. Default 50. */
	maxItems?: number;
	/** Maximum characters per comment body. Default 2000. */
	maxBodyLength?: number;
}

/** Compact comment item: id, author, date, bounded body. */
export interface CommentItem {
	id: number;
	author: CompactUser | null;
	created_at: string;
	body: TruncatedText;
}

/** Conversation section: PR conversation thread = issue comments. */
export interface ConversationSummary {
	total: number;
	returned: number;
	truncated: boolean;
	items: CommentItem[];
}

/**
 * Summarise the PR's conversation thread (Forgejo returns PR comments via the
 * issue-comments endpoint). Each body is bounded; the list is capped.
 *
 * NOTE: inline code-review comments are NOT included here — they live under
 * reviews. Use `list_review_comments` to drill into those.
 */
export function summarizeComments(
	comments: IssueComment[],
	opts: ConversationOptions = {},
): ConversationSummary {
	const maxItems = opts.maxItems ?? DEFAULT_MAX_COMMENTS;
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	const total = comments.length;
	const sliced = comments.slice(0, maxItems);
	return {
		total,
		returned: sliced.length,
		truncated: total > sliced.length,
		items: sliced.map((c) => ({
			id: c.id,
			author: compactUser(c.user),
			created_at: c.created_at,
			body: truncateText(c.body, maxBodyLength),
		})),
	};
}

/** Options controlling the `files_overview` section of a PR summary. */
export interface FilesOverviewOptions {
	/** Maximum number of file items to return. Default 100. */
	maxItems?: number;
	/**
	 * Maximum lines of patch to keep PER FILE. `0` (default) drops the patch
	 * entirely — only counts are returned, which is usually what an agent
	 * needs to triage. Set >0 to keep a bounded snippet with hunk headers.
	 */
	maxPatchLines?: number;
}

/** Compact file item: counts + optional bounded patch. */
export interface FileItem {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
	previous_filename?: string;
	patch?: TruncatedText;
	patch_excluded?: boolean;
}

/** Files-overview section: aggregate diff stats + bounded file list. */
export interface FilesOverviewSummary {
	total: number;
	returned: number;
	truncated: boolean;
	additions: number;
	deletions: number;
	items: FileItem[];
}

/**
 * Summarise the PR's files. By default patches are dropped (`patch_excluded:
 * true`) — the agent gets counts + statuses only, which is enough to decide
 * where to drill. Pass `maxPatchLines > 0` to keep a bounded snippet per file
 * (preserving `@@ ... @@` hunk headers).
 */
export function summarizeFilesOverview(
	files: PullRequestFile[],
	opts: FilesOverviewOptions = {},
): FilesOverviewSummary {
	const maxItems = opts.maxItems ?? DEFAULT_MAX_FILES;
	const maxPatchLines = opts.maxPatchLines ?? 0;
	const total = files.length;
	const sliced = files.slice(0, maxItems);
	return {
		total,
		returned: sliced.length,
		truncated: total > sliced.length,
		additions: totalAdditions(files),
		deletions: totalDeletions(files),
		items: sliced.map((f) => {
			const item: FileItem = {
				filename: f.filename,
				status: f.status,
				additions: f.additions,
				deletions: f.deletions,
				changes: f.changes,
			};
			if (f.previous_filename) {
				item.previous_filename = f.previous_filename;
			}
			if (!f.patch) {
				item.patch_excluded = true;
				return item;
			}
			if (maxPatchLines <= 0) {
				item.patch_excluded = true;
				return item;
			}
			item.patch = truncatePatch(f.patch, maxPatchLines);
			return item;
		}),
	};
}

/** Options controlling the `reviews` section of a PR summary. */
export interface ReviewsOptions {
	/** Maximum characters per review body. Default 2000. */
	maxBodyLength?: number;
}

/** Compact review item: id, state, author, date, bounded body. */
export interface ReviewItem {
	id: number;
	state: string;
	author: CompactUser | null;
	submitted_at: string;
	body: TruncatedText;
}

/** Reviews section: top-level reviews (no inline comments). */
export interface ReviewsSummary {
	total: number;
	items: ReviewItem[];
}

/**
 * Summarise the PR's reviews: state (APPROVE/REQUEST_CHANGES/COMMENT/...),
 * author, date, bounded body. Inline review comments are NOT included —
 * call `list_review_comments` with a specific `reviewId` to drill in.
 */
export function summarizeReviews(
	reviews: PullRequestReview[],
	opts: ReviewsOptions = {},
): ReviewsSummary {
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	return {
		total: reviews.length,
		items: reviews.map((r) => ({
			id: r.id,
			state: r.state,
			author: compactUser(r.user),
			submitted_at: r.submitted_at,
			body: truncateText(r.body, maxBodyLength),
		})),
	};
}

// ---------------------------------------------------------------------------
// Defaults — sized so a typical PR summary stays well under 10k characters.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_BODY_LENGTH = 2000;
export const DEFAULT_MAX_COMMITS = 50;
export const DEFAULT_MAX_COMMENTS = 50;
export const DEFAULT_MAX_FILES = 100;

/** Clamp a numeric tool arg to `[min, max]`, falling back to `fallback`. */
export function clampInt(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.min(max, Math.max(min, Math.trunc(value)));
	}
	if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		return Math.min(max, Math.max(min, parseInt(value.trim(), 10)));
	}
	return fallback;
}

/** Read a boolean tool arg, treating `undefined`/`null` as `fallback`. */
export function readBool(value: unknown, fallback: boolean): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	return fallback;
}
