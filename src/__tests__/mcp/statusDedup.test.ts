import { CommitStatus } from 'forgejo-ts';
import { deduplicateStatuses, summarizeStatuses } from '../../mcp/utils/statusDedup';
import {
	mockDuplicateStatuses,
	mockAllStatuses,
	mockMixedStatuses,
	expectedDeduplicatedContexts,
} from '../fixtures/commitStatuses';

describe('deduplicateStatuses', () => {
	it('collapses 12-record duplicate set to 6 unique contexts', () => {
		const result = deduplicateStatuses(mockDuplicateStatuses);
		expect(result).toHaveLength(6);
		const contexts = result.map((s) => s.context).sort();
		expect(contexts).toEqual([...expectedDeduplicatedContexts].sort());
	});

	it('removes all pending entries that were superseded by final statuses', () => {
		const result = deduplicateStatuses(mockDuplicateStatuses);
		const pending = result.filter((s) => s.status === 'pending');
		expect(pending).toHaveLength(0);
	});

	it('keeps the latest entry by created_at when there is a pending+final pair', () => {
		const result = deduplicateStatuses(mockDuplicateStatuses);
		const smokeTest = result.find((s) => s.context === 'Test / smoke-test-vsix (pull_request)');
		expect(smokeTest?.status).toBe('failure');
		expect(smokeTest?.description).toBe('Failing after 0s');
	});

	it('handles unsorted input', () => {
		const reversed = [...mockDuplicateStatuses].reverse();
		const result = deduplicateStatuses(reversed);
		expect(result).toHaveLength(6);
		const contexts = result.map((s) => s.context).sort();
		expect(contexts).toEqual([...expectedDeduplicatedContexts].sort());
	});

	it('keeps the first-seen entry when two records share the same created_at', () => {
		const sameTs = '2024-01-15T10:00:00Z';
		const a: CommitStatus = {
			id: 1, status: 'success', context: 'ci/a',
			description: 'first', target_url: '', created_at: sameTs, updated_at: sameTs,
		};
		const b: CommitStatus = {
			id: 2, status: 'failure', context: 'ci/a',
			description: 'second', target_url: '', created_at: sameTs, updated_at: sameTs,
		};
		const result = deduplicateStatuses([a, b]);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(1);
		expect(result[0].description).toBe('first');
	});

	it('filters out entries with invalid created_at dates', () => {
		const valid: CommitStatus = {
			id: 1, status: 'success', context: 'ci/good',
			description: 'ok', target_url: '', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z',
		};
		const invalid: CommitStatus = {
			id: 2, status: 'pending', context: 'ci/bad',
			description: 'not-a-date', target_url: '', created_at: 'invalid-date', updated_at: 'invalid-date',
		};
		const result = deduplicateStatuses([valid, invalid]);
		expect(result).toHaveLength(1);
		expect(result[0].context).toBe('ci/good');
	});

	it('returns empty array for empty input', () => {
		expect(deduplicateStatuses([])).toEqual([]);
	});
});

describe('summarizeStatuses', () => {
	it('returns "none" for empty array', () => {
		expect(summarizeStatuses([])).toBe('none');
	});

	it('returns "fail" when any status is error', () => {
		expect(summarizeStatuses(mockAllStatuses)).toBe('fail');
	});

	it('returns "fail" when any status is failure, even alongside successes', () => {
		expect(summarizeStatuses(mockMixedStatuses)).toBe('fail');
	});

	it('returns "pass" when all statuses are success', () => {
		const allSuccess: CommitStatus[] = [
			{ id: 1, status: 'success', context: 'a', description: '', target_url: '', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z' },
			{ id: 2, status: 'success', context: 'b', description: '', target_url: '', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z' },
		];
		expect(summarizeStatuses(allSuccess)).toBe('pass');
	});

	it('returns "pending" when only pending/warning remain (no failure, no success)', () => {
		const pendingOnly: CommitStatus[] = [
			{ id: 1, status: 'pending', context: 'a', description: '', target_url: '', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z' },
		];
		expect(summarizeStatuses(pendingOnly)).toBe('pending');
	});

	it('returns "pending" for warning status when no failure present', () => {
		const warningOnly: CommitStatus[] = [
			{ id: 1, status: 'warning', context: 'a', description: '', target_url: '', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z' },
		];
		expect(summarizeStatuses(warningOnly)).toBe('pending');
	});
});
