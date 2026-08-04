/**
 * Search tools — cross-resource discovery.
 *
 * Three read-only tools that hit Forgejo's global search endpoints:
 *
 * - `search_issues` — cross-repo issue/PR search via `/issues/search`.
 *   Supports filtering by type (issues/prs), state, assignee, author,
 *   labels, milestones, and a free-text query.
 * - `search_code`   — full-text code search via `/code/search`. Supports
 *   filtering by repo, user, or org.
 * - `search_users`  — user/account search via `/users/search`.
 *
 * All three return paginated envelopes and the raw SDK payload (no
 * compaction needed — Forgejo's search responses are already small).
 */

import { Tool, resolvePagination, buildPaginationMeta, pagedRequest } from './framework';
import {
	objectSchema,
	pageSchema,
	pageSizeSchema,
} from './schema';

/** Common optional filters shared by issues + code search. */
const searchFilterSchemas = {
	query: {
		type: 'string',
		description: 'Free-text search query. Matches issue title/body, code symbols, etc.',
		minLength: 1,
	},
	state: {
		type: 'string',
		enum: ['open', 'closed', 'all'],
		default: 'all',
		description: 'Filter by state (issues/PRs only).',
	},
	type: {
		type: 'string',
		enum: ['issues', 'pulls'],
		description: 'Restrict search to issues or PRs. Omit to search both.',
	},
	assignee: {
		type: 'string',
		description: 'Filter by assignee login.',
	},
	author: {
		type: 'string',
		description: 'Filter by author login.',
	},
	labels: {
		type: 'string',
		description: 'Comma-separated list of label names to filter by (e.g. "bug,urgent").',
	},
};

/**
 * Run a global search GET and translate an indexer-disabled 404 into a
 * helpful empty result instead of a bare HTTP error.
 *
 * Forgejo's `/issues/search` and `/code/search` endpoints return 404 when the
 * instance's search indexer is disabled (the default for many self-hosted
 * installs — `[indexer] ENABLED=false`) or when the index has not been
 * populated yet. A raw 404 is confusing (the agent can't tell "no results"
 * from "search is broken"). This helper adopts the same convention as
 * `get_branch_protection` (404 is treated as a data point, not a failure):
 * issues/code search → empty envelope with a `_meta.warning`; non-404 errors
 * propagate normally.
 */
async function runGlobalSearch(
	client: { rawRequest: <R = unknown>(method: string, endpoint: string) => Promise<R> },
	path: string,
	page: number,
	pageSize: number,
): Promise<{ items: unknown[]; warning?: string }> {
	try {
		const items = await pagedRequest(client, path, page, pageSize);
		return { items };
	} catch (err) {
		if ((err as { statusCode?: unknown }).statusCode === 404) {
			return {
				items: [],
				warning:
					'Search index is unavailable (Forgejo returned 404, typically because the ' +
					'search indexer is disabled or not yet populated). No results returned. ' +
					'Enable [indexer] in the Forgejo app.ini and re-run, or use scoped tools ' +
					'(list_issues / list_pull_requests / get_file_contents) instead.',
			};
		}
		throw err;
	}
}

export const searchIssuesTool: Tool = {
	name: 'search_issues',
	description:
		'Cross-repository search for issues and pull requests via GET /issues/search. ' +
		'Unlike list_issues (one repo at a time), this searches every repo the ' +
		'token has access to. Returns an array of matching issues/PRs with ' +
		'id, number, title, state, body, repository {id, owner, name, full_name}, ' +
		'user, labels, assignees, created_at, updated_at, etc. Useful for ' +
		'"find every issue assigned to me across my repos" or "find issues ' +
		'blocking release v2". Paginated. Note: returns an empty result with a ' +
		'_meta.warnings hint (not an error) when the Forgejo search indexer is ' +
		'disabled or unpopulated.',
	inputSchema: objectSchema(
		{
			query: searchFilterSchemas.query,
			state: searchFilterSchemas.state,
			type: searchFilterSchemas.type,
			assignee: searchFilterSchemas.assignee,
			author: searchFilterSchemas.author,
			labels: searchFilterSchemas.labels,
			milestone: {
				type: 'string',
				description: 'Filter by milestone title (within each repo).',
			},
			since: {
				type: 'string',
				description: 'Only issues updated at or after this time (RFC 3339 / ISO 8601).',
			},
			before: {
				type: 'string',
				description: 'Only issues updated before this time (RFC 3339 / ISO 8601).',
			},
			owner: {
				type: 'string',
				description: 'Restrict to a single owner (user or org login).',
			},
			repo: {
				type: 'string',
				description: 'Restrict to a single repo (requires owner).',
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['query'],
	),
	async handler({ args, client }): Promise<unknown> {
		const { page, pageSize } = resolvePagination(args);

		// Build query string. `type` filter is via the `type` param; everything
		// else is a query string parameter on /issues/search.
		const params: string[] = [`q=${encodeURIComponent(String(args.query))}`];
		if (typeof args.state === 'string') {
			params.push(`state=${encodeURIComponent(args.state)}`);
		}
		if (typeof args.type === 'string') {
			params.push(`type=${encodeURIComponent(args.type)}`);
		}
		if (typeof args.assignee === 'string' && args.assignee.trim() !== '') {
			params.push(`assigned=${encodeURIComponent(args.assignee.trim())}`);
		}
		if (typeof args.author === 'string' && args.author.trim() !== '') {
			params.push(`created=${encodeURIComponent(args.author.trim())}`);
		}
		if (typeof args.labels === 'string' && args.labels.trim() !== '') {
			params.push(`labels=${encodeURIComponent(args.labels.trim())}`);
		}
		if (typeof args.milestone === 'string' && args.milestone.trim() !== '') {
			params.push(`milestone=${encodeURIComponent(args.milestone.trim())}`);
		}
		if (typeof args.since === 'string' && args.since.trim() !== '') {
			params.push(`since=${encodeURIComponent(args.since.trim())}`);
		}
		if (typeof args.before === 'string' && args.before.trim() !== '') {
			params.push(`before=${encodeURIComponent(args.before.trim())}`);
		}
		if (typeof args.owner === 'string' && args.owner.trim() !== '') {
			params.push(`owner=${encodeURIComponent(args.owner.trim())}`);
		}
		if (typeof args.repo === 'string' && args.repo.trim() !== '') {
			params.push(`repo=${encodeURIComponent(args.repo.trim())}`);
		}

		const path = `/issues/search?${params.join('&')}`;
		const { items, warning } = await runGlobalSearch(client, path, page, pageSize);
		const _meta: { pagination: ReturnType<typeof buildPaginationMeta>; warnings?: string[] } = {
			pagination: buildPaginationMeta(page, pageSize, items.length),
		};
		if (warning) {
			_meta.warnings = [warning];
		}
		return { items, _meta };
	},
};

export const searchCodeTool: Tool = {
	name: 'search_code',
	description:
		'Full-text source code search via GET /code/search. Returns matching ' +
		'file references with repository, path, name, and a text_matches ' +
		'array (the actual code snippets that matched). Use this to find ' +
		'symbol usages, error message origins, or where a function is ' +
		'defined. Searches every repo the token has access to unless ' +
		'constrained by `repo` (within one owner). Paginated. Note: requires ' +
		'a search indexer enabled on the Forgejo instance — if the response ' +
		'is empty with a _meta.warnings hint, ask the admin to enable code ' +
		'indexing.',
	inputSchema: objectSchema(
		{
			query: searchFilterSchemas.query,
			owner: {
				type: 'string',
				description: 'Restrict to a single owner (user or org login).',
			},
			repo: {
				type: 'string',
				description: 'Restrict to a single repo (requires owner).',
			},
			user: {
				type: 'string',
				description: 'Restrict to repos owned by a single user.',
			},
			org: {
				type: 'string',
				description: 'Restrict to repos owned by a single org.',
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['query'],
	),
	async handler({ args, client }): Promise<unknown> {
		const { page, pageSize } = resolvePagination(args);
		const params: string[] = [`q=${encodeURIComponent(String(args.query))}`];
		if (typeof args.owner === 'string' && args.owner.trim() !== '') {
			params.push(`owner=${encodeURIComponent(args.owner.trim())}`);
		}
		if (typeof args.repo === 'string' && args.repo.trim() !== '') {
			params.push(`repo=${encodeURIComponent(args.repo.trim())}`);
		}
		if (typeof args.user === 'string' && args.user.trim() !== '') {
			params.push(`user=${encodeURIComponent(args.user.trim())}`);
		}
		if (typeof args.org === 'string' && args.org.trim() !== '') {
			params.push(`org=${encodeURIComponent(args.org.trim())}`);
		}
		const path = `/code/search?${params.join('&')}`;
		let allItems: unknown[] = [];
		let warning: string | undefined;
		try {
			const response = await client.rawRequest<{ data?: unknown[] }>('GET', path);
			allItems = Array.isArray(response.data) ? response.data : [];
		} catch (err) {
			if ((err as { statusCode?: unknown }).statusCode === 404) {
				warning =
					'Code search index is unavailable (Forgejo returned 404, typically because the ' +
					'search indexer is disabled or not yet populated). No results returned. Enable ' +
					'[indexer] with ENABLED=true in the Forgejo app.ini and re-run.';
			} else {
				throw err;
			}
		}
		// Code search responses are already small; apply pagination via slice.
		const start = (page - 1) * pageSize;
		const items = allItems.slice(start, start + pageSize);
		const _meta: { pagination: ReturnType<typeof buildPaginationMeta>; warnings?: string[] } = {
			pagination: buildPaginationMeta(page, pageSize, items.length),
		};
		if (warning) {
			_meta.warnings = [warning];
		}
		return {
			items,
			total_count: allItems.length,
			_meta,
		};
	},
};

export const searchUsersTool: Tool = {
	name: 'search_users',
	description:
		'Search Forgejo user accounts via GET /users/search. Returns matching ' +
		'users with id, login, full_name, avatar_url, html_url, and ' +
		'is_admin flag. Use this to look up login names before assigning ' +
		'issues or requesting reviews. Paginated.',
	inputSchema: objectSchema(
		{
			query: {
				type: 'string',
				description: 'Search query (matches login and full_name).',
				minLength: 1,
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['query'],
	),
	async handler({ args, client }): Promise<unknown> {
		const { page, pageSize } = resolvePagination(args);
		const path = `/users/search?q=${encodeURIComponent(String(args.query))}`;
		const response = await client.rawRequest<{ data?: unknown[] }>('GET', path);
		const allUsers = Array.isArray(response?.data) ? response.data : [];
		const start = (page - 1) * pageSize;
		const items = allUsers.slice(start, start + pageSize);
		return {
			items,
			total_count: allUsers.length,
			_meta: { pagination: buildPaginationMeta(page, pageSize, items.length) },
		};
	},
};

export const searchTools: Tool[] = [searchIssuesTool, searchCodeTool, searchUsersTool];
