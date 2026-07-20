import type {
	PullRequest,
	PullRequestCommit,
	PullRequestFile,
	PullRequestReview,
	Release,
} from 'forgejo-ts';
import type { Issue, IssueComment } from 'forgejo-ts';

import {
	truncateText,
	truncatePatch,
	shortSha,
	compactUser,
	commitSubject,
	totalAdditions,
	totalDeletions,
	summarizePrDescription,
	summarizeCommits,
	summarizeComments,
	summarizeFilesOverview,
	summarizeReviews,
	summarizeIssue,
	summarizeIssueListItem,
	summarizePrListItem,
	summarizeRelease,
	clampInt,
	readBool,
	DEFAULT_MAX_BODY_LENGTH,
	DEFAULT_MAX_COMMITS,
	DEFAULT_MAX_COMMENTS,
	DEFAULT_MAX_FILES,
} from '../../mcp/utils/responseFormat';

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe('truncateText', () => {
	it('returns the string unchanged when within the limit', () => {
		const r = truncateText('hello', 100);
		expect(r.text).toBe('hello');
		expect(r.truncated).toBe(false);
		expect(r.original_length).toBe(5);
	});

	it('truncates and appends the marker when over the limit', () => {
		const long = 'x'.repeat(50);
		const r = truncateText(long, 30);
		expect(r.truncated).toBe(true);
		expect(r.original_length).toBe(50);
		expect(r.text).toContain('truncated');
		expect(r.text.length).toBeLessThanOrEqual(30 + '… (truncated, 20 more chars)'.length);
	});

	it('normalises null/undefined to empty string', () => {
		expect(truncateText(null, 100).text).toBe('');
		expect(truncateText(undefined, 100).text).toBe('');
	});

	it('returns empty for equal-length string', () => {
		expect(truncateText('abc', 3)).toEqual({ text: 'abc', truncated: false, original_length: 3 });
	});
});

// ---------------------------------------------------------------------------
// truncatePatch
// ---------------------------------------------------------------------------

describe('truncatePatch', () => {
	const bigPatch = [
		'@@ -1,3 +1,3 @@',
		' context line',
		'-old line 1',
		'+new line 1',
		'@@ -10,3 +10,3 @@',
		' context line 2',
		'-old line 2',
		'+new line 2',
		'@@ -20,3 +20,3 @@',
		'-old line 3',
		'+new line 3',
	].join('\n');

	it('returns the patch unchanged when within the limit', () => {
		const r = truncatePatch('small patch', 10);
		expect(r.truncated).toBe(false);
		expect(r.text).toBe('small patch');
	});

	it('preserves all hunk headers even when body exceeds the limit', () => {
		const r = truncatePatch(bigPatch, 2);
		expect(r.truncated).toBe(true);
		// All three @@ hunk headers should survive.
		const headerLines = r.text.split('\n').filter((l) => l.startsWith('@@'));
		expect(headerLines).toHaveLength(3);
		// Marker present.
		expect(r.text).toContain('more lines)');
	});

	it('returns empty string with truncated=true when maxLines is 0 and patch exists', () => {
		const r = truncatePatch('some patch', 0);
		expect(r.text).toBe('');
		expect(r.truncated).toBe(true);
		expect(r.original_length).toBe(10);
	});

	it('returns empty non-truncated when input is empty', () => {
		const r = truncatePatch('', 5);
		expect(r.text).toBe('');
		expect(r.truncated).toBe(false);
	});

	it('handles null/undefined input', () => {
		expect(truncatePatch(null, 5).text).toBe('');
		expect(truncatePatch(undefined, 5).text).toBe('');
	});
});

// ---------------------------------------------------------------------------
// shortSha / compactUser / commitSubject
// ---------------------------------------------------------------------------

describe('shortSha', () => {
	it('returns the first 7 chars by default', () => {
		expect(shortSha('abcdef1234567890')).toBe('abcdef1');
	});
	it('respects custom length', () => {
		expect(shortSha('abcdef1234567890', 10)).toBe('abcdef1234');
	});
	it('returns empty for empty input', () => {
		expect(shortSha('')).toBe('');
	});
});

describe('compactUser', () => {
	it('returns { login } from a user object', () => {
		const u = { login: 'alice', avatar_url: 'http://x' };
		expect(compactUser(u)).toEqual({ login: 'alice' });
	});
	it('drops avatar_url', () => {
		const u = { login: 'bob', avatar_url: 'http://y' };
		const r = compactUser(u);
		expect(r).not.toHaveProperty('avatar_url');
	});
	it('returns null for missing login', () => {
		expect(compactUser(null)).toBeNull();
		expect(compactUser({ login: '' })).toBeNull();
		expect(compactUser(undefined)).toBeNull();
	});
});

describe('commitSubject', () => {
	it('returns the first line of a multi-line message', () => {
		expect(commitSubject('Fix bug\n\nDetailed body\nMore detail')).toBe('Fix bug');
	});
	it('trims whitespace', () => {
		expect(commitSubject('  Fix bug  ')).toBe('Fix bug');
	});
	it('returns empty for undefined', () => {
		expect(commitSubject(undefined)).toBe('');
		expect(commitSubject('')).toBe('');
	});
});

describe('totalAdditions / totalDeletions', () => {
	it('sums additions across files', () => {
		expect(totalAdditions([{ additions: 10 }, { additions: 5 }, {}])).toBe(15);
	});
	it('sums deletions across files', () => {
		expect(totalDeletions([{ deletions: 3 }, { deletions: 7 }, {}])).toBe(10);
	});
	it('returns 0 for empty array', () => {
		expect(totalAdditions([])).toBe(0);
		expect(totalDeletions([])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// summarizePrDescription
// ---------------------------------------------------------------------------

const mockPr: PullRequest = {
	id: 100, number: 42, title: 'Fix bug', body: 'x'.repeat(5000),
	state: 'open', user: { login: 'alice', avatar_url: 'http://x' },
	created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
	html_url: 'http://pr/42', head: { ref: 'feature', sha: 'a'.repeat(40), repo: { full_name: 'o/r' } },
	base: { ref: 'main' }, mergeable: true, merged: false, merge_commit_sha: null,
	draft: false, comments: 3, labels: [{ name: 'bug', color: '#f00' }],
};

describe('summarizePrDescription', () => {
	it('returns compact metadata with bounded body', () => {
		const r = summarizePrDescription(mockPr, { maxBodyLength: 100 });
		expect(r.number).toBe(42);
		expect(r.title).toBe('Fix bug');
		expect(r.author).toEqual({ login: 'alice' });
		expect(r.base_ref).toBe('main');
		expect(r.head_ref).toBe('feature');
		expect(r.head_sha).toBe('a'.repeat(40));
		expect(r.body.truncated).toBe(true);
		expect(r.body.original_length).toBe(5000);
		expect(r.labels).toEqual([{ name: 'bug' }]);
	});

	it('uses DEFAULT_MAX_BODY_LENGTH when no opts', () => {
		const r = summarizePrDescription(mockPr);
		expect(r.body.truncated).toBe(true); // 5000 > 2000
		expect(DEFAULT_MAX_BODY_LENGTH).toBe(2000);
	});

	it('handles missing body', () => {
		const r = summarizePrDescription({ ...mockPr, body: '' });
		expect(r.body.truncated).toBe(false);
		expect(r.body.text).toBe('');
	});

	it('does not crash when labels is undefined', () => {
		// Older Forgejo instances and certain PR shapes return no labels field.
		// Previously `.labels.map()` threw TypeError. Now we degrade to [].
		const prNoLabels = { ...mockPr } as Partial<typeof mockPr>;
		delete (prNoLabels as { labels?: unknown }).labels;
		const r = summarizePrDescription(prNoLabels as typeof mockPr);
		expect(r.labels).toEqual([]);
	});

	it('does not crash when head/base are null (deleted source repo)', () => {
		const r = summarizePrDescription({ ...mockPr, head: null as unknown as typeof mockPr.head, base: null as unknown as typeof mockPr.base });
		expect(r.head_ref).toBe('');
		expect(r.head_sha).toBe('');
		expect(r.base_ref).toBe('');
	});

	it('filters out invalid label entries (null/empty name)', () => {
		const pr = { ...mockPr, labels: [{ name: 'bug' }, null, { name: '' }, { name: 'enhancement' }] } as unknown as typeof mockPr;
		const r = summarizePrDescription(pr);
		expect(r.labels).toEqual([{ name: 'bug' }, { name: 'enhancement' }]);
	});
});

// ---------------------------------------------------------------------------
// summarizeCommits
// ---------------------------------------------------------------------------

const makeCommit = (n: number): PullRequestCommit => ({
	sha: n.toString().repeat(40),
	commit: { message: `Commit ${n}\n\nBody text`, author: { name: `user${n}`, email: `u${n}@x`, date: '2025-01-01T00:00:00Z' } },
	author: { login: `user${n}`, avatar_url: 'http://x' },
	html_url: `http://commit/${n}`,
});

describe('summarizeCommits', () => {
	it('returns all commits when within the limit', () => {
		const r = summarizeCommits([makeCommit(1), makeCommit(2)], { maxItems: 50 });
		expect(r.total).toBe(2);
		expect(r.returned).toBe(2);
		expect(r.truncated).toBe(false);
		expect(r.items[0].short_sha).toHaveLength(7);
		expect(r.items[0].subject).toBe('Commit 1');
		expect(r.items[0].commit_author).toBe('user1');
	});

	it('truncates the list when over the limit', () => {
		const commits = Array.from({ length: 60 }, (_, i) => makeCommit(i + 1));
		const r = summarizeCommits(commits, { maxItems: 10 });
		expect(r.total).toBe(60);
		expect(r.returned).toBe(10);
		expect(r.truncated).toBe(true);
	});

	it('uses DEFAULT_MAX_COMMITS when no opts', () => {
		expect(DEFAULT_MAX_COMMITS).toBe(50);
		const r = summarizeCommits(Array.from({ length: 60 }, (_, i) => makeCommit(i + 1)));
		expect(r.returned).toBe(50);
	});

	it('returns empty for empty input', () => {
		const r = summarizeCommits([]);
		expect(r.total).toBe(0);
		expect(r.items).toEqual([]);
	});

	it('does not crash when commit.commit or commit.author is missing (ghost author)', () => {
		// GitHub-imported commits, detached commits, or commits from deleted
		// accounts can have null commit.author. Previously the access to
		// `c.commit.author.name` threw TypeError.
		const ghost = {
			sha: 'b'.repeat(40),
			commit: undefined,
			author: { login: 'ghost' },
			html_url: '',
		} as unknown as PullRequestCommit;
		const r = summarizeCommits([ghost]);
		expect(r.items[0].commit_author).toBe('');
		expect(r.items[0].date).toBe('');
		expect(r.items[0].subject).toBe('');
	});

	it('does not crash when commit.commit.author is null', () => {
		const ghost = {
			sha: 'c'.repeat(40),
			commit: { message: 'msg', author: null },
			author: null,
		} as unknown as PullRequestCommit;
		const r = summarizeCommits([ghost]);
		expect(r.items[0].commit_author).toBe('');
	});
});

// ---------------------------------------------------------------------------
// summarizeComments
// ---------------------------------------------------------------------------

const makeComment = (n: number, body?: string): IssueComment => ({
	id: n, body: body ?? `Comment ${n}`,
	user: { login: `commenter${n}`, avatar_url: 'http://x' },
	created_at: '2025-01-01T00:00:00Z', html_url: `http://c/${n}`,
});

describe('summarizeComments', () => {
	it('returns all comments when within limits', () => {
		const r = summarizeComments([makeComment(1), makeComment(2)]);
		expect(r.total).toBe(2);
		expect(r.truncated).toBe(false);
		expect(r.items[0].author).toEqual({ login: 'commenter1' });
	});

	it('truncates the list when over maxItems', () => {
		const comments = Array.from({ length: 60 }, (_, i) => makeComment(i + 1));
		const r = summarizeComments(comments, { maxItems: 10 });
		expect(r.returned).toBe(10);
		expect(r.truncated).toBe(true);
	});

	it('truncates body when over maxBodyLength', () => {
		const r = summarizeComments([makeComment(1, 'y'.repeat(3000))], { maxBodyLength: 100 });
		expect(r.items[0].body.truncated).toBe(true);
		expect(r.items[0].body.original_length).toBe(3000);
	});

	it('uses DEFAULT_MAX_COMMENTS when no opts', () => {
		expect(DEFAULT_MAX_COMMENTS).toBe(50);
		const r = summarizeComments(Array.from({ length: 60 }, (_, i) => makeComment(i + 1)));
		expect(r.returned).toBe(50);
	});
});

// ---------------------------------------------------------------------------
// summarizeFilesOverview
// ---------------------------------------------------------------------------

const makeFile = (n: number, patch?: string): PullRequestFile => ({
	filename: `file${n}.ts`, status: 'modified',
	additions: n, deletions: n, changes: 2 * n,
	blob_url: `http://b/${n}`, raw_url: `http://r/${n}`, contents_url: `http://c/${n}`,
	patch: patch ?? `@@ -1,1 +1,1 @@\n+line${n}`,
});

describe('summarizeFilesOverview', () => {
	it('drops patches by default (maxPatchLines=0)', () => {
		const r = summarizeFilesOverview([makeFile(1)]);
		expect(r.items[0].patch_excluded).toBe(true);
		expect(r.items[0]).not.toHaveProperty('patch');
		expect(r.additions).toBe(1);
		expect(r.deletions).toBe(1);
	});

	it('truncates the file list when over maxItems', () => {
		const files = Array.from({ length: 60 }, (_, i) => makeFile(i + 1));
		const r = summarizeFilesOverview(files, { maxItems: 10 });
		expect(r.total).toBe(60);
		expect(r.returned).toBe(10);
		expect(r.truncated).toBe(true);
		// additions/deletions computed across ALL files, not just returned ones.
		expect(r.additions).toBe(60 * 61 / 2); // sum 1..60
	});

	it('keeps bounded patch when maxPatchLines > 0', () => {
		const longPatch = '@@ -1,1 +1,1 @@\n' + Array.from({ length: 20 }, (_, i) => `+line${i}`).join('\n');
		const r = summarizeFilesOverview([makeFile(1, longPatch)], { maxPatchLines: 3 });
		expect(r.items[0].patch!.truncated).toBe(true);
		expect(r.items[0].patch!.text).toContain('@@');
	});

	it('preserves previous_filename for renames', () => {
		const r = summarizeFilesOverview([{ ...makeFile(1), previous_filename: 'old.ts' }]);
		expect(r.items[0].previous_filename).toBe('old.ts');
	});

	it('uses DEFAULT_MAX_FILES when no opts', () => {
		expect(DEFAULT_MAX_FILES).toBe(100);
		const files = Array.from({ length: 150 }, (_, i) => makeFile(i + 1));
		const r = summarizeFilesOverview(files);
		expect(r.returned).toBe(100);
	});
});

// ---------------------------------------------------------------------------
// summarizeReviews
// ---------------------------------------------------------------------------

describe('summarizeReviews', () => {
	it('returns all reviews', () => {
		const reviews: PullRequestReview[] = [
			{ id: 1, state: 'APPROVE', body: 'LGTM', user: { login: 'r1', avatar_url: 'x' }, submitted_at: '2025-01-01', html_url: 'h1' },
			{ id: 2, state: 'COMMENT', body: 'note', user: { login: 'r2', avatar_url: 'x' }, submitted_at: '2025-01-02', html_url: 'h2' },
		];
		const r = summarizeReviews(reviews);
		expect(r.total).toBe(2);
		expect(r.items[0].state).toBe('APPROVE');
		expect(r.items[0].author).toEqual({ login: 'r1' });
		expect(r.items[0].body.truncated).toBe(false);
	});

	it('truncates long review bodies', () => {
		const reviews: PullRequestReview[] = [
			{ id: 1, state: 'COMMENT', body: 'z'.repeat(5000), user: { login: 'r1', avatar_url: 'x' }, submitted_at: '2025-01-01', html_url: 'h1' },
		];
		const r = summarizeReviews(reviews, { maxBodyLength: 100 });
		expect(r.items[0].body.truncated).toBe(true);
		expect(r.items[0].body.original_length).toBe(5000);
	});

	it('returns empty for empty input', () => {
		expect(summarizeReviews([]).total).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// clampInt / readBool
// ---------------------------------------------------------------------------

describe('clampInt', () => {
	it('clamps to the valid range', () => {
		expect(clampInt(5, 1, 10, 3)).toBe(5);
		expect(clampInt(0, 1, 10, 3)).toBe(1);
		expect(clampInt(100, 1, 10, 3)).toBe(10);
	});
	it('uses fallback for non-numeric input', () => {
		expect(clampInt('abc', 1, 10, 3)).toBe(3);
		expect(clampInt(undefined, 1, 10, 3)).toBe(3);
		expect(clampInt(null, 1, 10, 3)).toBe(3);
	});
	it('parses numeric strings', () => {
		expect(clampInt('5', 1, 10, 3)).toBe(5);
	});
	it('truncates floats', () => {
		expect(clampInt(5.9, 1, 10, 3)).toBe(5);
	});
});

describe('readBool', () => {
	it('returns the boolean when given one', () => {
		expect(readBool(true, false)).toBe(true);
		expect(readBool(false, true)).toBe(false);
	});
	it('returns fallback for non-boolean', () => {
		expect(readBool(undefined, true)).toBe(true);
		expect(readBool(null, false)).toBe(false);
		expect(readBool('yes', true)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// summarizeIssue  (default compact shape for get_issue tool)
// ---------------------------------------------------------------------------

const mockIssue: Issue & {
	due_date?: string | null;
	is_locked?: boolean;
	assets?: unknown[];
	milestone?: { title?: string } | null;
} = {
	id: 1,
	number: 790,
	title: 'Удалить информацию о руководителях',
	body: 'sample body',
	state: 'open',
	user: { login: 'Yeldashev_T', avatar_url: 'http://x' },
	labels: [
		{ name: 'IN PROGRESS', color: 'fbca04' },
		{ name: 'off-roadmap', color: 'e11d21' },
	],
	assignees: [{ login: 'Ai40404' }],
	created_at: '2026-07-13T16:07:39+05:00',
	updated_at: '2026-07-14T13:17:11+05:00',
	closed_at: null,
	html_url: 'http://git.example.com/sarkor/project_management/issues/790',
	comments: 2,
	due_date: '2026-07-14T23:59:59+05:00',
	is_locked: false,
	milestone: null,
	assets: [
		{ id: 1, name: 'screenshot.png', size: 4096, uuid: 'abc-123', download_count: 0, browser_download_url: 'http://dl' },
	],
};

describe('summarizeIssue', () => {
	it('keeps identifier + dates + bounded body', () => {
		const r = summarizeIssue(mockIssue, { maxBodyLength: 100 });
		expect(r.number).toBe(790);
		expect(r.title).toBe('Удалить информацию о руководителях');
		expect(r.state).toBe('open');
		expect(r.created_at).toBe(mockIssue.created_at);
		expect(r.updated_at).toBe(mockIssue.updated_at);
		expect(r.closed_at).toBeNull();
		expect(r.due_at).toBe('2026-07-14T23:59:59+05:00');
		expect(r.html_url).toBe(mockIssue.html_url);
		expect(r.body.original_length).toBe(mockIssue.body.length);
	});

	it('compact user: keeps login + full_name when present, drops avatar_url', () => {
		const r = summarizeIssue(mockIssue);
		expect(r.author).toEqual({ login: 'Yeldashev_T' });
		expect(r.assignees).toEqual([{ login: 'Ai40404' }]);
		// Pulls full_name in when present. The forgejo-ts stub type omits
		// `full_name` but real API responses include it (cast around tsc).
		const enriched = {
			...mockIssue,
			user: { login: 'Yeldashev_T', avatar_url: 'u', full_name: 'Елдашев Тахир' } as unknown as typeof mockIssue.user,
		} as typeof mockIssue;
		expect(summarizeIssue(enriched).author).toEqual({ login: 'Yeldashev_T', full_name: 'Елдашев Тахир' });
	});

	it('labels: drops color, keeps names only', () => {
		const r = summarizeIssue(mockIssue);
		expect(r.labels).toEqual([{ name: 'IN PROGRESS' }, { name: 'off-roadmap' }]);
	});

	it('attachments: keeps name/size/uuid/download_count, drops browser_download_url', () => {
		const r = summarizeIssue(mockIssue);
		expect(r.attachments).toEqual([{ name: 'screenshot.png', size: 4096, id: 1, uuid: 'abc-123', download_count: 0 }]);
		r.attachments.forEach((a) => expect(a).not.toHaveProperty('browser_download_url'));
	});

	it('milestone: returns {title} when set, null when absent', () => {
		expect(summarizeIssue(mockIssue).milestone).toBeNull();
		const withMilestone = { ...mockIssue, milestone: { title: 'Sprint 14' } };
		expect(summarizeIssue(withMilestone).milestone).toEqual({ title: 'Sprint 14' });
		const withEmptyMilestone = { ...mockIssue, milestone: { title: '' } };
		expect(summarizeIssue(withEmptyMilestone).milestone).toBeNull();
	});

	it('handles any missing optional fields gracefully', () => {
		const minimal: Issue = {
			id: 2, number: 1, title: 't', body: 'b', state: 'open',
			user: { login: 'u', avatar_url: 'a' }, labels: [], assignees: [],
			created_at: 'c', updated_at: 'u', closed_at: null, html_url: 'h', comments: 0,
		};
		const r = summarizeIssue(minimal);
		expect(r.due_at).toBeNull();
		expect(r.is_locked).toBe(false);
		expect(r.milestone).toBeNull();
		expect(r.attachments).toEqual([]);
		expect(r.comments_count).toBe(0);
		expect(r.author).toEqual({ login: 'u' });
	});
});

// ---------------------------------------------------------------------------
// summarizeIssueListItem / summarizePrListItem / summarizeRelease
// ---------------------------------------------------------------------------

describe('summarizeIssueListItem', () => {
	it('returns a compact list item (bounded body, author reduced, labels flattened)', () => {
		const longBody = 'x'.repeat(3000);
		const issue: Issue = {
			id: 7, number: 7, title: 'I', state: 'open', body: longBody,
			user: { login: 'a', avatar_url: 'u' },
			labels: [{ name: 'bug', color: '#f00' }],
			assignees: [],
			created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
			closed_at: null, html_url: 'http://i/7', comments: 4,
		};
		const r = summarizeIssueListItem(issue, { maxBodyLength: 100 });
		expect(r.number).toBe(7);
		expect(r.body.truncated).toBe(true);
		expect(r.author).toEqual({ login: 'a' });
		expect(r.labels).toEqual([{ name: 'bug' }]);
		expect(r.comments_count).toBe(4);
		expect(r.html_url).toBe(issue.html_url);
	});
});

describe('summarizePrListItem', () => {
	it('returns mergeable/merged/draft flags + base/head refs + bounded body', () => {
		const longBody = 'y'.repeat(6000);
		const pr: PullRequest = {
			id: 1, number: 42, title: 'PR', body: longBody, state: 'open',
			user: { login: 'alice', avatar_url: 'u' },
			created_at: '2025-01-01T00:00:00Z', updated_at: '2025-06-01T00:00:00Z',
			html_url: 'http://pr/42',
			head: { ref: 'feature', sha: 'a'.repeat(40), repo: { full_name: 'o/r' } },
			base: { ref: 'main' },
			mergeable: true, merged: false, merge_commit_sha: null,
			draft: false, comments: 5, labels: [{ name: 'bug', color: '#f00' }],
		};
		const r = summarizePrListItem(pr, { maxBodyLength: 200 });
		expect(r.number).toBe(42);
		expect(r.base_ref).toBe('main');
		expect(r.head_ref).toBe('feature');
		expect(r.draft).toBe(false);
		expect(r.merged).toBe(false);
		expect(r.mergeable).toBe(true);
		expect(r.body.truncated).toBe(true);
		expect(r.body.original_length).toBe(6000);
		expect(r.author).toEqual({ login: 'alice' });
		expect(r.labels).toEqual([{ name: 'bug' }]);
	});
});

describe('summarizeRelease', () => {
	const mockRelease: Release = {
		id: 5, tag_name: 'v2.0', name: 'Second', body: 'y'.repeat(3000),
		draft: false, prerelease: false,
		author: { login: 'alice', avatar_url: 'http://a' },
		created_at: '2025-01-01T00:00:00Z', published_at: '2025-01-02T00:00:00Z',
		html_url: 'http://rel/5', tarball_url: 'http://tb', zipball_url: 'http://zb',
		assets: [{
			id: 11, name: 'asset.zip', size: 999, download_count: 3, browser_download_url: 'http://dl',
		}],
	};

	it('keeps id/tag/name + draft/prerelease + dates + html_url', () => {
		const r = summarizeRelease(mockRelease, { maxBodyLength: 100 });
		expect(r.id).toBe(5);
		expect(r.tag_name).toBe('v2.0');
		expect(r.name).toBe('Second');
		expect(r.draft).toBe(false);
		expect(r.prerelease).toBe(false);
		expect(r.created_at).toBe(mockRelease.created_at);
		expect(r.published_at).toBe(mockRelease.published_at);
		expect(r.html_url).toBe(mockRelease.html_url);
	});

	it('bounds the changelog body', () => {
		const r = summarizeRelease(mockRelease, { maxBodyLength: 100 });
		expect(r.body.truncated).toBe(true);
		expect(r.body.original_length).toBe(3000);
	});

	it('compact author: keeps login + full_name when present, drops avatar_url', () => {
		const r = summarizeRelease(mockRelease);
		expect(r.author).toEqual({ login: 'alice' });
		// TypeScript object literals reject extra `full_name`; the real API
		// returns it. Cast through `unknown` to exercise the runtime path.
		const enriched = {
			...mockRelease,
			author: { login: 'alice', avatar_url: 'x', full_name: 'Alice Liddell' } as unknown as typeof mockRelease.author,
		} as typeof mockRelease;
		expect(summarizeRelease(enriched).author).toEqual({ login: 'alice', full_name: 'Alice Liddell' });
	});

	it('assets: drops browser_download_url, keeps name/size/download_count', () => {
		const r = summarizeRelease(mockRelease);
		expect(r.assets).toEqual([{ name: 'asset.zip', size: 999, id: 11, download_count: 3 }]);
		r.assets.forEach((a) => expect(a).not.toHaveProperty('browser_download_url'));
	});

	it('drops tarball_url / zipball_url', () => {
		const r = summarizeRelease(mockRelease);
		expect(r).not.toHaveProperty('tarball_url');
		expect(r).not.toHaveProperty('zipball_url');
	});

	it('null published_at handled', () => {
		const r = summarizeRelease({ ...mockRelease, published_at: '' });
		expect(r.published_at).toBeNull();
	});
});
