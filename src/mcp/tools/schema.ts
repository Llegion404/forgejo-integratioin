/**
 * Shared JSON Schema fragments used by the MCP tool definitions.
 *
 * Each fragment is a plain JSON Schema object (RFC 8927) so the same module
 * works without Zod or any runtime validator dependency. The MCP server
 * validates inputs itself before invoking the underlying Forgejo SDK method,
 * returning a clear tool error (`isError: true`) when validation fails.
 */

export interface JsonSchema {
	type?: string;
	description?: string;
	enum?: unknown[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean | JsonSchema;
	[key: string]: unknown;
}

export const ownerSchema: JsonSchema = {
	type: 'string',
	description: 'Repository owner (login). Required unless FORGEJO_OWNER env var is set.',
};

export const repoSchema: JsonSchema = {
	type: 'string',
	description: 'Repository name. Required unless FORGEJO_REPO env var is set.',
};

export const numberSchema: JsonSchema = {
	type: 'integer',
	description: 'Issue or PR number (e.g. 42). Cannot be a PR/issue URL — pass the integer only.',
	minimum: 1,
};

export const issueStateSchema: JsonSchema = {
	type: 'string',
	enum: ['open', 'closed', 'all'],
	default: 'open',
	description: 'Filter by state. Defaults to "open".',
};

export const pullRequestStateSchema: JsonSchema = {
	type: 'string',
	enum: ['open', 'closed', 'all'],
	default: 'open',
	description: 'Filter by state. Defaults to "open".',
};

export const limitSchema: JsonSchema = {
	type: 'integer',
	minimum: 1,
	maximum: 100,
	default: 30,
	description: 'Maximum number of items to return (capped at 100 by the API).',
};

export const shaSchema: JsonSchema = {
	type: 'string',
	description: '40 or 64 character hex commit SHA (not a branch name or ref).',
	minLength: 40,
};

export const branchSchema: JsonSchema = {
	type: 'string',
	description: 'Git branch name (e.g. main, master, release/1.0).',
	minLength: 1,
};

export const pathSchema: JsonSchema = {
	type: 'string',
	description: 'Path to a file in the repository, relative to the repo root.',
	minLength: 1,
};

export const refSchema: JsonSchema = {
	type: 'string',
	description: 'Git ref: a branch name, tag name, or commit SHA.',
	minLength: 1,
};

export const commentIdSchema: JsonSchema = {
	type: 'integer',
	description: 'Numeric comment id (from the `id` field of an entry returned by list_issue_comments).',
	minimum: 1,
};

export const releaseIdSchema: JsonSchema = {
	type: 'integer',
	description: 'Numeric release id (from the `id` field of an entry returned by list_releases).',
	minimum: 1,
};

export const uuidSchema: JsonSchema = {
	type: 'string',
	description: 'UUID of a Forgejo file/attachment (from the `uuid` field of a list_issue_attachments entry).',
	minLength: 1,
};

/**
 * Shared "give me the raw, untouched SDK response" toggle.
 *
 * Tools that ship a compact-by-default shape accept `full: false` (default)
 * → returns the agent-optimised summary. `full: true` short-circuits the
 * handler to return the raw underlying API payload unchanged — for the
 * (rare) case where an agent needs a field the compact path drops.
 */
export const fullSchema: JsonSchema = {
	type: 'boolean',
	default: false,
	description:
		'Return the raw unchanged SDK response instead of the compact agent-optimised shape. ' +
		'Default false (compact). Set true only when you need a field the compact path omits.',
};

/** Helper to build an object schema with required + optional fields. */
export function objectSchema(
	properties: Record<string, JsonSchema>,
	required: string[] = [],
): JsonSchema {
	return {
		type: 'object',
		properties,
		required: required.length > 0 ? required : undefined,
		additionalProperties: false,
	};
}
