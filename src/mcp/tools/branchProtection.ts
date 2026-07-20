/**
 * Branch protection read tools.
 *
 * forgejo-ts has no typed methods for branch protection, so these tools
 * use `rawRequest('GET', ...)`. Two read-only tools:
 * - `list_branch_protections` — every protection rule in a repo.
 * - `get_branch_protection`   — the protection rule for one specific branch.
 *
 * Response shape is defined by the Forgejo REST API (see
 * https://codeberg.org/forgejo/forgejo/src/branch/forgejo/routers/api/v1/repo/branch.go).
 * A protection rule typically includes: rule_name, enable_push, enable_push_whitelist,
 * enable_merge_whitelist, enable_status_check, required_approvals, enable_approvals_whitelist,
 * required_status_checks, etc.
 *
 * `get_branch_protection` translates a 404 response into a structured
 * `{ protected: false }` envelope so agents can distinguish "branch has no
 * protection rule" from "branch doesn't exist" / "permission denied" —
 * previously a 404 surfaced as `isError: true` with an opaque message.
 */

import { Tool, resolveOwner, resolveRepo } from './framework';
import { objectSchema, ownerSchema, repoSchema, branchSchema } from './schema';
import { ForgejoApiError } from 'forgejo-ts';

export const listBranchProtectionsTool: Tool = {
	name: 'list_branch_protections',
	description:
		'List all branch protection rules in a repository. Each rule ' +
		'defines which branches are protected and the required reviews, ' +
		'status checks, and push restrictions for direct commits. Returns ' +
		'an empty array when the repo has no protected branches.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		return client.rawRequest(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branch_protections`,
		);
	},
};

export const getBranchProtectionTool: Tool = {
	name: 'get_branch_protection',
	description:
		'Get the protection rule for a specific branch (e.g. main, master, ' +
		'release/1.0). Returns `{ protected: true, rule: {...} }` when the ' +
		'branch has a protection rule, or `{ protected: false }` when it ' +
		'does not (no isError). The rule object includes required_approvals, ' +
		'enable_status_check, required_status_checks, enable_push_whitelist, ' +
		'etc. Other errors (404 branch missing, 403 permission) still ' +
		'surface as isError.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			branch: branchSchema,
		},
		['branch'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const branch = String(args['branch']);
		try {
			const rule = await client.rawRequest(
				'GET',
				`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branch_protections/${encodeURIComponent(branch)}`,
			);
			return { protected: true, branch, rule };
		} catch (err) {
			// Forgejo returns 404 when no protection rule exists for the
			// branch. Translate that specific case into a structured
			// "protected: false" envelope so agents don't see isError.
			if (err instanceof ForgejoApiError && err.statusCode === 404) {
				return { protected: false, branch, rule: null };
			}
			throw err;
		}
	},
};

export const branchProtectionTools: Tool[] = [listBranchProtectionsTool, getBranchProtectionTool];
