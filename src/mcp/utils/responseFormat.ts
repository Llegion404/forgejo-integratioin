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
	Release,
	ReleaseAsset,
} from 'forgejo-ts';
import type { Issue, IssueComment } from 'forgejo-ts';

/**
 * Compact user: login + optional full_name (kept because it carries
 * human context an agent may reference when drafting replies; avatar_url
 * is always dropped — pure noise for non-rendering agents).
 */
export interface CompactUser {
	login: string;
	full_name?: string;
}

/**
 * Defensive shorthand to read an optional string property from a loosely
 * shaped API object. The forgejo-ts stub types omit a lot of fields the
 * real API actually returns (e.g. Issue.due_date, User.full_name), so
 * summarizers below accept `Record<string, unknown>`-ish inputs and use
 * this helper instead of optional chaining alone.
 */
function readString(v: unknown): string | undefined {
	if (typeof v === 'string' && v.trim() !== '') {
		return v;
	}
	return undefined;
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

/**
 * Reduce a User-like object to `{ login, full_name? }`. Drops avatar_url,
 * id, email, language, followers_count and every other bloated field the
 * Forgejo REST API stuffs onto User objects. `full_name` is kept when
 * present and non-empty — agents drafting replies benefit from the human
 * name; everything else is noise.
 */
export function compactUser(u: { login?: string | null; full_name?: string | null } | null | undefined): CompactUser | null {
	if (!u?.login) {
		return null;
	}
	const fullName = readString(u.full_name);
	const out: CompactUser = { login: u.login };
	if (fullName) {
		out.full_name = fullName;
	}
	return out;
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
// Compact list-item summarizers — bounded per-item shapes for the *list*
// tools (list_issues, list_pull_requests, list_releases). Each drops noise
// (avatar_urls, full user objects, multi-line bodies, assets) and keeps
// only what an agent needs to triage one item in a list. To drill in,
// call the single-resource tool which returns a fuller compact shape.
// ---------------------------------------------------------------------------

/**
 * Options controlling the per-item compaction of list responses.
 * Same field caps as the full-summary path, applied per list item.
 */
export interface ListItemOptions {
	/** Maximum characters per body string. Default 2000. */
	maxBodyLength?: number;
}

/**
 * Compact attachment reference kept on issue/PR bodies and comments.
 * Drops `browser_download_url` (an agent can re-derive it from owner/repo
 * + uuid) but keeps `uuid` so `get_attachment` can fetch the bytes.
 */
export interface AttachmentItem {
	uuid?: string;
	id?: number;
	name: string;
	size: number;
	download_count?: number;
}

/** Defensive attachment normaliser: accepts full Forgejo Asset shape. */
function compactAttachment(a: Record<string, unknown>): AttachmentItem {
	const item: AttachmentItem = {
		name: readString(a.name) ?? '(unnamed)',
		size: typeof a.size === 'number' ? a.size : 0,
	};
	const id = a.id;
	if (typeof id === 'number') {
		item.id = id;
	}
	const uuid = readString(a.uuid);
	if (uuid) {
		item.uuid = uuid;
	}
	const dc = a.download_count;
	if (typeof dc === 'number') {
		item.download_count = dc;
	}
	return item;
}

/**
 * Compact label: just the name (drops color, id, description, url —
 * an agent triaging issue taxonomy rarely needs the hex code).
 */
export interface CompactLabel {
	name: string;
}

/** Defensive label normaliser: keeps name only, skips invalid entries. */
function compactLabel(l: Record<string, unknown> | null | undefined): CompactLabel | null {
	const name = readString(l?.name);
	if (!name) {
		return null;
	}
	return { name };
}

/** Options controlling `summarizeIssue`. */
export interface IssueSummaryOptions {
	/** Maximum characters for the issue body. Default 2000. */
	maxBodyLength?: number;
}

/**
 * Compact issue shape returned by `get_issue` (default path).
 *
 * Includes everything an agent needs to fully take over an issue:
 * number/title/state for identity, body (bounded) for the actual task,
 * html_url for cross-reference, dates (created/updated/closed + due) for
 * SLA context, labels (names only) + milestone (title only) for taxonomy,
 * author + assignees as `{ login, full_name? }` so the agent knows who
 * to loop in, comment count to gauge existing discussion, `is_locked` to
 * short-circuit attempts to comment. The conversation thread is fetched
 * separately by `get_issue` and merged into the response envelope.
 */
export interface IssueSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	body: TruncatedText;
	html_url: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	due_at: string | null;
	author: CompactUser | null;
	assignees: CompactUser[];
	labels: CompactLabel[];
	milestone: { title: string } | null;
	comments_count: number;
	is_locked: boolean;
	attachments: AttachmentItem[];
}

/**
 * Summarise a full Forgejo Issue object into the compact agent shape.
 *
 * The forgejo-ts stub types omit fields the real API returns (`due_date`,
 * `is_locked`, `assets`, `assignee` singular, `milestone`, `pull_request`,
 * `repository`); the Issue type the SDK declares only models a subset. The
 * runtime Object is much richer (see the example Issue returned by
 * `GET /repos/{owner}/{repo}/issues/{number}`), so this function accepts
 * the typed `Issue` plus the extra known fields via an intersection and
 * falls back gracefully (null / false / []) when any are missing.
 */
export function summarizeIssue(
	issue: Issue & {
		due_date?: string | null;
		is_locked?: boolean;
		assets?: unknown[] | null;
		milestone?: { title?: string } | null;
		closed_at?: string | null;
	},
	opts: IssueSummaryOptions = {},
): IssueSummary {
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	const assetsArr = Array.isArray(issue.assets) ? issue.assets : [];
	const milestoneTitle = issue.milestone ? readString(issue.milestone.title) : undefined;
	return {
		number: issue.number,
		title: issue.title,
		state: issue.state,
		body: truncateText(issue.body, maxBodyLength),
		html_url: issue.html_url,
		created_at: issue.created_at,
		updated_at: issue.updated_at,
		closed_at: issue.closed_at ?? null,
		due_at: readString(issue.due_date) ?? null,
		author: compactUser(issue.user),
		assignees: (issue.assignees ?? [])
			.map((a) => compactUser(a))
			.filter((x): x is CompactUser => x !== null),
		labels: (issue.labels ?? [])
			.map((l) => compactLabel(l as unknown as Record<string, unknown>))
			.filter((x): x is CompactLabel => x !== null),
		milestone: milestoneTitle ? { title: milestoneTitle } : null,
		comments_count: typeof issue.comments === 'number' ? issue.comments : 0,
		is_locked: issue.is_locked === true,
		attachments: assetsArr
			.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
			.map(compactAttachment),
	};
}

/** Compact issue list item: enough to triage one issue out of many. */
export interface IssueListItemSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	body: TruncatedText;
	html_url: string;
	created_at: string;
	updated_at?: string;
	closed_at?: string | null;
	author: CompactUser | null;
	labels: CompactLabel[];
	comments_count: number;
}

/**
 * Summarise a single issue from `list_issues`. The Forgejo REST `/issues`
 * endpoint returns the full Issue shape (not the `IssueListItem` the SDK
 * type stub declares), so we can include the bounded body + labels +
 * author — enough to triage without a second round-trip to `get_issue`.
 */
export function summarizeIssueListItem(
	issue: Issue & { updated_at?: string; closed_at?: string | null },
	opts: ListItemOptions = {},
): IssueListItemSummary {
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	return {
		number: issue.number,
		title: issue.title,
		state: issue.state,
		body: truncateText(issue.body, maxBodyLength),
		html_url: issue.html_url,
		created_at: issue.created_at,
		updated_at: readString(issue.updated_at),
		closed_at: issue.closed_at ?? null,
		author: compactUser(issue.user),
		labels: (issue.labels ?? [])
			.map((l) => compactLabel(l as unknown as Record<string, unknown>))
			.filter((x): x is CompactLabel => x !== null),
		comments_count: typeof issue.comments === 'number' ? issue.comments : 0,
	};
}

/** Compact PR list item: enough to triage one PR out of many. */
export interface PrListItemSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	draft: boolean;
	merged: boolean;
	mergeable: boolean;
	base_ref: string;
	head_ref: string;
	body: TruncatedText;
	html_url: string;
	author: CompactUser | null;
	created_at: string;
	updated_at: string;
	labels: CompactLabel[];
	comments_count: number;
}

/**
 * Summarise a single PR from `list_pull_requests`. The SDK returns the
 * full PullRequest shape (not PullRequestListItem), so we keep the merge
 * state + refs + bounded body and drop everything else.
 */
export function summarizePrListItem(pr: PullRequest, opts: ListItemOptions = {}): PrListItemSummary {
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
		body: truncateText(pr.body, maxBodyLength),
		html_url: pr.html_url,
		author: compactUser(pr.user),
		created_at: pr.created_at,
		updated_at: pr.updated_at,
		labels: (pr.labels ?? [])
			.map((l) => compactLabel(l as unknown as Record<string, unknown>))
			.filter((x): x is CompactLabel => x !== null),
		comments_count: typeof pr.comments === 'number' ? pr.comments : 0,
	};
}

/** Options controlling `summarizeRelease`. */
export interface ReleaseSummaryOptions {
	/** Maximum characters for the release body (changelog). Default 2000. */
	maxBodyLength?: number;
}

/** Compact release item. */
export interface ReleaseSummary {
	id: number;
	tag_name: string;
	name: string;
	body: TruncatedText;
	draft: boolean;
	prerelease: boolean;
	author: CompactUser | null;
	created_at: string;
	published_at: string | null;
	html_url: string;
	assets: AttachmentItem[];
}

/**
 * Summarise a single Release: bounded changelog body, author as
 * `{ login, full_name? }`, assets reduced to `{ name, size, uuid?,
 * download_count? }` (drops browser_download_url — agent can rebuild the
 * URL from owner/repo + tag).
 */
export function summarizeRelease(release: Release, opts: ReleaseSummaryOptions = {}): ReleaseSummary {
	const maxBodyLength = opts.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;
	return {
		id: release.id,
		tag_name: release.tag_name,
		name: release.name,
		body: truncateText(release.body, maxBodyLength),
		draft: release.draft,
		prerelease: release.prerelease,
		author: compactUser(release.author),
		created_at: release.created_at,
		published_at: readString(release.published_at) ?? null,
		html_url: release.html_url,
		assets: (release.assets ?? [])
			.filter((a): a is ReleaseAsset => !!a && typeof a === 'object')
			.map((a) => compactAttachment(a as unknown as Record<string, unknown>)),
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
