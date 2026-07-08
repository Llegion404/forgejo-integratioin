import type {
	PullRequest,
	PullRequestCommit,
	PullRequestFile,
	PullRequestReview,
} from 'forgejo-ts';
import type { IssueComment } from 'forgejo-ts';

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
