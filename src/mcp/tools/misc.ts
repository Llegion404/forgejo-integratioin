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
	fullSchema,
} from './schema';
import {
	summarizeRelease,
	clampInt,
	readBool,
	DEFAULT_MAX_BODY_LENGTH,
} from '../utils/responseFormat';
import type { Release } from 'forgejo-ts';

export const listReleasesTool: Tool = {
	name: 'list_releases',
	description:
		'List all releases in a Forgejo repository. Default (full=false) ' +
		'returns a compact array: each release has id, tag_name, name, ' +
		'bounded body (≤2000 chars, the changelog), draft, prerelease, ' +
		'author ({login, full_name?}), created_at, published_at, html_url, ' +
		'and assets reduced to {name, size, uuid?, download_count?}. ' +
		'Pass full=true for the raw SDK payload (untouched, includes ' +
		'tarball_url, zipball_url, browser_download_url on assets, full ' +
		'author objects). Auto-paginated.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			full: fullSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters per release body (changelog) when full=false. Default 2000.',
			},
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const releases: Release[] = await client.listReleases(owner, repo);
		if (readBool(args.full, false)) {
			return releases;
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return releases.map((r) => summarizeRelease(r, { maxBodyLength }));
	},
};

export const getReleaseTool: Tool = {
	name: 'get_release',
	description:
		'Fetch a single release by its numeric id (the `id` field from a ' +
		'list_releases entry, NOT the tag_name). Default (full=false) ' +
		'returns a compact shape (bounded changelog body, author as ' +
		'{login, full_name?}, assets as {name, size, uuid?, ' +
		'download_count?}). Pass full=true for the raw SDK Release object ' +
		'including tarball_url/zipball_url and unbounded changelog.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			id: releaseIdSchema,
			full: fullSchema,
			max_body_length: {
				type: 'integer',
				minimum: 100,
				maximum: 20000,
				default: 2000,
				description: 'Max characters for the release body (changelog) when full=false. Default 2000.',
			},
		},
		['id'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const id = resolveNumber(args, 'id');
		const release: Release = await client.getRelease(owner, repo, id);
		if (readBool(args.full, false)) {
			return release;
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return summarizeRelease(release, { maxBodyLength });
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
