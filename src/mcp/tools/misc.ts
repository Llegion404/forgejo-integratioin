/**
 * Misc read tools — wrappers around SDK-typed methods the extension already
 * uses but the MCP server didn't expose.
 *
 * - `list_releases`      → listReleases(owner, repo)            — Release[]
 * - `get_release`        → getRelease(owner, repo, id)         — Release
 * - `get_file_contents`  → getFileContents(owner, repo, path, ref) — string
 * - `list_tags`          → listTags(owner, repo)               — Tag[]
 *
 * All four methods are inherited unchanged from forgejo-ts's ForgejoClient
 * (see node_modules/forgejo-ts/dist/client.d.ts:58,95,98,100). The wrapper
 * only adds `noopLogger` — no behavioral overrides.
 */

import { Tool, resolveOwner, resolveRepo, resolveNumber } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	pathSchema,
	refSchema,
	releaseIdSchema,
} from './schema';

export const listReleasesTool: Tool = {
	name: 'list_releases',
	description:
		'List all releases in a Forgejo repository. For each release ' +
		'returns id, tag_name, name, body (markdown changelog), draft, ' +
		'prerelease, author, created_at, published_at, html_url, and ' +
		'assets (attached binaries with download_count). Auto-paginated.',
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
		return client.listReleases(owner, repo);
	},
};

export const getReleaseTool: Tool = {
	name: 'get_release',
	description:
		'Fetch a single release by its numeric id (the `id` field from a ' +
		'list_releases entry, NOT the tag_name). Returns the full Release ' +
		'object including body (changelog markdown) and assets.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			id: releaseIdSchema,
		},
		['id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const id = resolveNumber(args, 'id');
		return client.getRelease(owner, repo, id);
	},
};

export const getFileContentsTool: Tool = {
	name: 'get_file_contents',
	description:
		'Fetch the decoded text content of a file in a repository at a ' +
		'specific ref (branch name, tag, or commit SHA). Returns the file ' +
		'content as a string (base64 auto-decoded by the SDK). Use this to ' +
		'read README.md, CHANGELOG.md, source files, or config files.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			path: pathSchema,
			ref: refSchema,
		},
		['path', 'ref'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const filePath = String(args['path']);
		const ref = String(args['ref']);
		return client.getFileContents(owner, repo, filePath, ref);
	},
};

export const listTagsTool: Tool = {
	name: 'list_tags',
	description:
		'List all tags in a repository. For each tag returns name, id, ' +
		'message, commit.sha, commit.url, zipball_url, tarball_url. Useful ' +
		'for understanding the release history independent of formal ' +
		'Release objects.',
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
		return client.listTags(owner, repo);
	},
};

export const miscTools: Tool[] = [listReleasesTool, getReleaseTool, getFileContentsTool, listTagsTool];
