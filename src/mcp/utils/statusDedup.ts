/**
 * Pure helpers for collapsing the Forgejo `/repos/{o}/{r}/statuses/{sha}`
 * response and producing a human/agent-friendly summary verdict.
 *
 * The Forgejo commit-statuses API returns every historical status record for
 * a SHA: the initial `pending` record AND the final `success`/`failure`
 * record for each CI job. Without deduplication an agent sees the same job
 * twice (once as "Waiting to run", once as "Successful in 3m20s"), which is
 * confusing. We collapse by `context`, keeping only the entry with the
 * newest `created_at` timestamp.
 *
 * Copied verbatim from `src/providers/prDetailsContentProvider.ts:119-132`
 * (the VS Code extension's copy of the same logic). Keeping both copies is
 * intentional: the extension version is bound to a `vscode.TextDocumentContentProvider`
 * class and pulls in `'vscode'`, which the MCP server cannot import.
 */

import type { CommitStatus } from 'forgejo-ts';

/**
 * Collapse duplicate CI status records by `context`, keeping the entry
 * with the newest `created_at` timestamp.
 *
 * Entries whose `created_at` is not parseable as a date are dropped, since
 * the comparison requires a numeric timestamp.
 */
export function deduplicateStatuses(statuses: CommitStatus[]): CommitStatus[] {
	const latestByContext = new Map<string, CommitStatus>();
	for (const status of statuses) {
		const key = status.context;
		const statusDate = new Date(status.created_at).getTime();
		if (isNaN(statusDate)) continue;
		const existing = latestByContext.get(key);
		const existingDate = existing ? new Date(existing.created_at).getTime() : -Infinity;
		if (statusDate > existingDate) {
			latestByContext.set(key, status);
		}
	}
	return Array.from(latestByContext.values());
}

export type StatusSummary = 'none' | 'pending' | 'fail' | 'pass';

/**
 * Produce a single verdict across all CI statuses for a commit.
 *
 * Precedence (matches `actionsTreeProvider.getAggregateStatusIcon` in the
 * extension): any failure/error wins; otherwise any pending/warning; otherwise
 * pass; otherwise none (when the array is empty).
 */
export function summarizeStatuses(statuses: CommitStatus[]): StatusSummary {
	if (statuses.length === 0) return 'none';
	for (const s of statuses) {
		if (s.status === 'error' || s.status === 'failure') return 'fail';
	}
	for (const s of statuses) {
		if (s.status === 'pending' || s.status === 'warning') return 'pending';
	}
	return 'pass';
}
