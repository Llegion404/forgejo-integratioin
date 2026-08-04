/**
 * Workflow / Actions read-only tools.
 *
 * Exposes Forgejo's CI/Actions surface to AI agents. Six tools:
 *
 * - `list_workflows`            — enumerate workflow files (rawRequest).
 * - `list_workflow_runs`        — recent runs with filters (state/branch/actor).
 * - `get_workflow_run`          — single run detail.
 * - `get_workflow_jobs`         — jobs + steps for a run.
 * - `get_workflow_logs`         — full text logs for a job.
 * - `list_workflow_artifacts`   — artifacts produced by a run (download URLs).
 *
 * All list-shaped tools accept `page` (default 1) + `page_size` (default 30,
 * max 50) and return a `_meta.pagination` envelope. The SDK's
 * `listWorkflowRuns` auto-pages; we bypass it via rawRequest to bound the
 * fetch and prevent DoS on repos with many runs.
 *
 * Why no `rerun_workflow` tool: per the user's decision, the MCP server
 * stays read-only. Agents that need to retry a run can do so via the
 * VS Code extension's action tree, or via direct REST call.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber, resolvePagination, buildPaginationMeta } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	numberSchema,
	pageSchema,
	pageSizeSchema,
} from './schema';

/** Build the standard /repos/{owner}/{repo} URL prefix, URL-encoded. */
function repoBase(owner: string, repo: string): string {
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Standard directories where Forgejo/Gitea expect workflow files to live.
 * Both are checked (in order) — the returned list is the union.
 */
const WORKFLOW_DIRS = ['.forgejo/workflows', '.gitea/workflows'];

/**
 * Fetch the entries of a repo directory via the contents API. Returns null
 * when the directory does not exist (404), so callers can treat "no workflow
 * dir" as an empty result rather than an error.
 */
async function listRepoDirectory(
	client: { rawRequest: <R = unknown>(method: string, endpoint: string) => Promise<R> },
	owner: string,
	repo: string,
	path: string,
	ref: string,
): Promise<Record<string, unknown>[] | null> {
	try {
		const result = await client.rawRequest(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
		);
		return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
	} catch (err) {
		if ((err as { statusCode?: unknown }).statusCode === 404) {
			return null;
		}
		throw err;
	}
}

export const listWorkflowsTool: Tool = {
	name: 'list_workflows',
	description:
		'List the workflow files defined in a repository (.forgejo/workflows/*.yml ' +
		'or .gitea/workflows/*.yml). Enumerates the workflow directories on the ' +
		'repository default branch and returns each file with name, path, type, ' +
		'size, sha, and html_url. Repos with no workflow directory return an empty ' +
		'list (not an error). Use this to discover what CI pipelines exist before ' +
		'listing runs. Paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			ref: {
				type: 'string',
				description: 'Branch/tag/commit to list workflows at. Defaults to the repository default branch.',
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const { page, pageSize } = resolvePagination(args);

		// Resolve the ref: an explicit one from args, else the repo's default
		// branch (fetched via the repo endpoint).
		let ref = typeof args.ref === 'string' && args.ref.trim() !== '' ? args.ref.trim() : '';
		if (ref === '') {
			const repoInfo = await client.rawRequest<{ default_branch?: string }>(
				'GET',
				`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
			);
			ref = (repoInfo as { default_branch?: string }).default_branch ?? '';
		}
		if (ref === '') {
			return { items: [], _meta: { pagination: buildPaginationMeta(page, pageSize, 0) } };
		}

		// Union of .forgejo/workflows and .gitea/workflows. A missing dir just
		// contributes nothing.
		const all: Record<string, unknown>[] = [];
		for (const dir of WORKFLOW_DIRS) {
			const entries = await listRepoDirectory(client, owner, repo, dir, ref);
			if (entries) {
				all.push(...entries);
			}
		}

		const start = (page - 1) * pageSize;
		const items = all.slice(start, start + pageSize);
		return { items, _meta: { pagination: buildPaginationMeta(page, pageSize, items.length) } };
	},
};

export const listWorkflowRunsTool: Tool = {
	name: 'list_workflow_runs',
	description:
		'List recent workflow runs in a repository. Each run includes id, name, ' +
		'status, conclusion, head_branch, head_sha, event, html_url, and ' +
		'timestamps. Optional filters: status (waiting/queued/in_progress/' +
		'success/failure/cancelled/skipped/blocked), branch (e.g. main). ' +
		'Use this to find failed runs or to monitor CI health. Paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			status: {
				type: 'string',
				description: 'Filter by run status. One of: waiting, queued, in_progress, success, failure, cancelled, skipped, blocked, action_required.',
			},
			branch: {
				type: 'string',
				description: 'Filter by head branch name (e.g. main, feature/x).',
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const { page, pageSize } = resolvePagination(args);

		// Build filtered path. Forgejo's actions/tasks endpoint accepts
		// `status` and `branch` query params (same shape as the SDK's
		// listWorkflowRuns but without the unbounded auto-paging).
		const params: string[] = [];
		if (typeof args.status === 'string' && args.status.trim() !== '') {
			params.push(`status=${encodeURIComponent(args.status.trim())}`);
		}
		if (typeof args.branch === 'string' && args.branch.trim() !== '') {
			params.push(`branch=${encodeURIComponent(args.branch.trim())}`);
		}
		const query = params.length > 0 ? `?${params.join('&')}` : '';
		const path = `${repoBase(owner, repo)}/actions/tasks${query}`;

		const response = await client.rawRequest<{ workflow_runs?: unknown[]; total_count?: number }>('GET', path);
		// The actions/tasks endpoint returns the entire matching set in one
		// response (capped server-side). Apply our own pagination by slicing.
		const allRuns = Array.isArray(response?.workflow_runs) ? response.workflow_runs : [];
		const start = (page - 1) * pageSize;
		const items = allRuns.slice(start, start + pageSize);
		return {
			items,
			total_count: typeof response?.total_count === 'number' ? response.total_count : allRuns.length,
			_meta: { pagination: buildPaginationMeta(page, pageSize, items.length) },
		};
	},
};

export const getWorkflowRunTool: Tool = {
	name: 'get_workflow_run',
	description:
		'Fetch a single workflow run by its numeric id (the `id` field from ' +
		'a list_workflow_runs entry). Returns id, name, head_branch, head_sha, ' +
		'status, conclusion, event, started_at, updated_at, html_url, and the ' +
		'run attempt number. Use this to inspect one run without pulling the ' +
		'full list.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			id: {
				type: 'integer',
				description: 'Workflow run id (from list_workflow_runs).',
				minimum: 1,
			},
		},
		['id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const id = resolveNumber(args, 'id');
		return client.rawRequest('GET', `${repoBase(owner, repo)}/actions/runs/${id}`);
	},
};

export const getWorkflowJobsTool: Tool = {
	name: 'get_workflow_jobs',
	description:
		'List the jobs inside a workflow run. Each job includes id, name, ' +
		'status, conclusion, started_at, completed_at, html_url, and the ' +
		'steps array (name, status, conclusion, number, started_at, ' +
		'completed_at). Use this after get_workflow_run to see which jobs ' +
		'failed and which steps caused the failure.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			id: {
				type: 'integer',
				description: 'Workflow run id (from list_workflow_runs or get_workflow_run).',
				minimum: 1,
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const id = resolveNumber(args, 'id');
		const { page, pageSize } = resolvePagination(args);
		// The SDK's getWorkflowJobs returns the full response without
		// pagination; the underlying endpoint also doesn't paginate. Apply
		// our own slice so the result is bounded.
		const response = await client.rawRequest<{ jobs?: unknown[]; total_count?: number }>(
			'GET',
			`${repoBase(owner, repo)}/actions/runs/${id}/jobs`,
		);
		const allJobs = Array.isArray(response?.jobs) ? response.jobs : [];
		const start = (page - 1) * pageSize;
		const items = allJobs.slice(start, start + pageSize);
		return {
			items,
			total_count: typeof response?.total_count === 'number' ? response.total_count : allJobs.length,
			_meta: { pagination: buildPaginationMeta(page, pageSize, items.length) },
		};
	},
};

export const getWorkflowLogsTool: Tool = {
	name: 'get_workflow_logs',
	description:
		'Fetch the log text for a workflow run / job. Returns the raw log ' +
		'content as a string (potentially large — callers should be prepared ' +
		'to handle multi-MB payloads). Pass the run number (NOT the run id) — ' +
		'this is the URL-visible sequence number like 42, 143, etc. Optional ' +
		'jobRef narrows the fetch to one job. Logs are scraped from the ' +
		'Forgejo web UI (same path the extension uses), so private repos ' +
		'auth-restricted to API tokens may return an empty string — try the ' +
		'VS Code extension or open the run in a browser as a fallback.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			run_number: {
				type: 'integer',
				description: 'Workflow run number (the URL-visible sequence number, NOT the database id).',
				minimum: 1,
			},
			job_ref: {
				type: 'integer',
				description: 'Optional job index or id to fetch logs for a single job instead of all.',
				minimum: 0,
			},
		},
		['run_number'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const runNumber = resolveNumber(args, 'run_number');
		const jobRef = typeof args.job_ref === 'number' ? args.job_ref : 0;
		const text: string = await client.getWorkflowLogs(owner, repo, runNumber, jobRef);
		// Logs can be enormous; cap to 200 KB to keep tool responses manageable.
		const MAX_LOG_BYTES = 200 * 1024;
		if (typeof text === 'string' && text.length > MAX_LOG_BYTES) {
			return {
				content: text.slice(0, MAX_LOG_BYTES),
				truncated: true,
				original_length: text.length,
				warning: `Logs truncated to ${MAX_LOG_BYTES} chars; ${text.length - MAX_LOG_BYTES} more chars omitted. Fetch via browser for full log.`,
			};
		}
		return { content: text, truncated: false, original_length: typeof text === 'string' ? text.length : 0 };
	},
};

export const listWorkflowArtifactsTool: Tool = {
	name: 'list_workflow_artifacts',
	description:
		'List artifacts produced by a workflow run. Each artifact includes ' +
		'id, name, size_in_bytes, url (download), archive_download_url, ' +
		'expired, and expires_at. Use this to find build outputs, test ' +
		'reports, or coverage data produced by CI. Artifacts marked ' +
		'expired=true can no longer be downloaded.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			id: {
				type: 'integer',
				description: 'Workflow run id (from list_workflow_runs).',
				minimum: 1,
			},
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		['id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const id = resolveNumber(args, 'id');
		const { page, pageSize } = resolvePagination(args);
		const response = await client.rawRequest<{ artifacts?: unknown[]; total_count?: number }>(
			'GET',
			`${repoBase(owner, repo)}/actions/runs/${id}/artifacts`,
		);
		const allArtifacts = Array.isArray(response?.artifacts) ? response.artifacts : [];
		const start = (page - 1) * pageSize;
		const items = allArtifacts.slice(start, start + pageSize);
		return {
			items,
			total_count: typeof response?.total_count === 'number' ? response.total_count : allArtifacts.length,
			_meta: { pagination: buildPaginationMeta(page, pageSize, items.length) },
		};
	},
};

export const workflowTools: Tool[] = [
	listWorkflowsTool,
	listWorkflowRunsTool,
	getWorkflowRunTool,
	getWorkflowJobsTool,
	getWorkflowLogsTool,
	listWorkflowArtifactsTool,
];
