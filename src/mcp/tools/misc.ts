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

import { Tool, resolveOwner, resolveRepo, resolveNumber, resolvePagination, buildPaginationMeta, pagedRequest } from './framework';
import {
	objectSchema,
	ownerSchema,
	repoSchema,
	pathSchema,
	refSchema,
	releaseIdSchema,
	fullSchema,
	pageSchema,
	pageSizeSchema,
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
		'author objects). Paginated: pass page (default 1) and page_size ' +
		'(default 30, max 50).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			full: fullSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
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
		const { page, pageSize } = resolvePagination(args);
		const releases = await pagedRequest<Release>(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, releases.length);
		if (readBool(args.full, false)) {
			return { items: releases, _meta: { pagination } };
		}
		const maxBodyLength = clampInt(args.max_body_length, 100, 20000, DEFAULT_MAX_BODY_LENGTH);
		return {
			items: releases.map((r) => summarizeRelease(r, { maxBodyLength })),
			_meta: { pagination },
		};
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
		'content as a string for text files. Binary files (images, PDFs, ' +
		'compiled artifacts) are detected via the Forgejo `encoding` field ' +
		'and returned as `{ is_binary: true, size, encoding, mime_guess }` ' +
		'without the mojibake payload — call get_attachment for image ' +
		'assets or use raw git for other binaries. Files above max_bytes ' +
		'(default 512 KB, max 5 MB) return the same metadata envelope. ' +
		'Use this to read README.md, CHANGELOG.md, source files, or config files.',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			path: pathSchema,
			ref: refSchema,
			max_bytes: {
				type: 'integer',
				minimum: 1024,
				maximum: 5_242_880,
				default: 524_288,
				description:
					'Max file size (bytes) to return as decoded text. Files ' +
					'larger than this are returned as a metadata envelope ' +
					'(is_binary:true, size, mime_guess) without content. ' +
					'Default 512 KB. Max 5 MB.',
			},
		},
		['path', 'ref'],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const filePath = String(args['path']);
		const ref = String(args['ref']);
		const maxBytes = clampInt(args.max_bytes, 1024, 5_242_880, 524_288);

		// Hit the contents endpoint via rawRequest so we can inspect size +
		// encoding BEFORE deciding whether to decode. The SDK's
		// `getFileContents` returns only the decoded content string, which is
		// garbled UTF-8 mojibake for binaries and unbounded for huge files.
		const meta = await client.rawRequest<{ content?: string | null; encoding?: string; size?: number; name?: string; path?: string; sha?: string; url?: string; html_url?: string }>(
			'GET',
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`,
		);

		const size = typeof meta.size === 'number' ? meta.size : (meta.content?.length ?? 0);
		const encoding = typeof meta.encoding === 'string' ? meta.encoding : 'unknown';
		const mimeGuess = guessMimeFromPath(meta.name ?? filePath);

		// 1) Too large → return metadata only.
		// 2) Binary encoding (base64 of non-text) → return metadata only.
		// Forgejo uses `encoding: 'base64'` for both text and binary, but
		// also indicates binary-ness by the presence of NUL bytes after
		// decode. We can't inspect without decoding, so we use a NUL-byte
		// heuristic when the file is under the size cap.
		if (size > maxBytes) {
			return {
				path: meta.path ?? filePath,
				name: meta.name,
				sha: meta.sha,
				size,
				encoding,
				is_binary: isBinaryMime(mimeGuess),
				mime_guess: mimeGuess,
				truncated: true,
				max_bytes: maxBytes,
				warning: `File is ${size} bytes; exceeds max_bytes (${maxBytes}). Use raw git or a smaller max_bytes to fetch.`,
				html_url: meta.html_url,
			};
		}

		// Decode if needed.
		let content = meta.content ?? '';
		if (encoding === 'base64') {
			try {
				content = Buffer.from(content, 'base64').toString('utf8');
			} catch {
				return {
					path: meta.path ?? filePath,
					name: meta.name,
					sha: meta.sha,
					size,
					encoding,
					is_binary: true,
					mime_guess: mimeGuess,
					warning: 'Base64 decode failed; file is likely binary.',
					html_url: meta.html_url,
				};
			}
		}

		// Binary heuristic: NUL byte or >5% replacement chars (U+FFFD).
		const decoded = typeof content === 'string' ? content : '';
		if (looksBinary(decoded)) {
			return {
				path: meta.path ?? filePath,
				name: meta.name,
				sha: meta.sha,
				size,
				encoding,
				is_binary: true,
				mime_guess: mimeGuess,
				warning: 'File content appears binary (NUL byte or non-text byte ratio above threshold). Use raw git for the original bytes.',
				html_url: meta.html_url,
			};
		}

		return {
			path: meta.path ?? filePath,
			name: meta.name,
			sha: meta.sha,
			size,
			encoding: 'utf8',
			is_binary: false,
			mime_guess: mimeGuess,
			content,
			html_url: meta.html_url,
		};
	},
};

/** Common binary mime prefixes — informs the metadata-only envelope. */
function isBinaryMime(mime: string): boolean {
	return /^(image|audio|video|application\/(octet-stream|pdf|zip|x-tar|x-gzip|x-shockwave-flash|x-7z-compressed|vnd\.microsoft\.portable-executable|x-msdownload|x-executable|x-sharedlib))/i.test(mime);
}

/** Crude MIME guesser from filename extension. */
function guessMimeFromPath(name: string): string {
	const ext = (name.split('.').pop() ?? '').toLowerCase();
	const map: Record<string, string> = {
		md: 'text/markdown', txt: 'text/plain', ts: 'text/typescript', tsx: 'text/tsx',
		js: 'text/javascript', jsx: 'text/jsx', json: 'application/json', yml: 'text/yaml',
		yaml: 'text/yaml', toml: 'text/toml', html: 'text/html', css: 'text/css', scss: 'text/scss',
		py: 'text/x-python', go: 'text/x-go', rs: 'text/x-rust', java: 'text/x-java',
		c: 'text/x-c', cpp: 'text/x-c++', h: 'text/x-c', rb: 'text/x-ruby', php: 'text/x-php',
		sh: 'text/x-shellscript', xml: 'text/xml', svg: 'image/svg+xml',
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
		ico: 'image/x-icon', bmp: 'image/bmp', tiff: 'image/tiff',
		pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
		'7z': 'application/x-7z-compressed', rar: 'application/x-rar',
		mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav',
		so: 'application/x-sharedlib', dll: 'application/x-msdownload', exe: 'application/x-executable',
	};
	return map[ext] ?? 'application/octet-stream';
}

/**
 * Binary heuristic: returns true when the decoded content has a NUL byte
 * in the first 8 KB OR has >5% U+FFFD replacement characters (signal of
 * non-UTF-8 bytes that decoded to garbage).
 */
function looksBinary(decoded: string): boolean {
	if (!decoded) {
		return false;
	}
	const sample = decoded.length > 8192 ? decoded.slice(0, 8192) : decoded;
	if (sample.includes('\u0000')) {
		return true;
	}
	// Count U+FFFD in the sample.
	let replacements = 0;
	for (let i = 0; i < sample.length; i++) {
		if (sample.charCodeAt(i) === 0xfffd) {
			replacements++;
			if (replacements > sample.length * 0.05) {
				return true;
			}
		}
	}
	return false;
}

export const listTagsTool: Tool = {
	name: 'list_tags',
	description:
		'List all tags in a repository. For each tag returns name, id, ' +
		'message, commit.sha, commit.url, zipball_url, tarball_url. Useful ' +
		'for understanding the release history independent of formal ' +
		'Release objects. Paginated: pass page (default 1) and page_size ' +
		'(default 30, max 50).',
	inputSchema: objectSchema(
		{
			owner: ownerSchema,
			repo: repoSchema,
			page: pageSchema,
			page_size: pageSizeSchema,
		},
		[],
	),
	async handler({ args, client, config }): Promise<unknown> {
		const owner = resolveOwner(args, config);
		const repo = resolveRepo(args, config);
		const { page, pageSize } = resolvePagination(args);
		const items = await pagedRequest(
			client,
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`,
			page, pageSize,
		);
		const pagination = buildPaginationMeta(page, pageSize, items.length);
		return { items, _meta: { pagination } };
	},
};

export const miscTools: Tool[] = [listReleasesTool, getReleaseTool, getFileContentsTool, listTagsTool];
