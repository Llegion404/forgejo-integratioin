/**
 * Repository discovery tool.
 *
 * `search_repositories` — wraps Forgejo's /repos/search endpoint so the agent
 *   can find the owner/repo for an issue or PR before calling the more
 *   specific tools. Without this, an agent given only a repo URL by the user
 *   has no way to discover the canonical owner/repo pair.
 */

import { Tool, resolveNumber } from './framework';
import { objectSchema, limitSchema } from './schema';

export const searchRepositoriesTool: Tool = {
	name: 'search_repositories',
	description:
		'Search Forgejo repositories by keyword via GET /repos/search. ' +
		'Returns matching repositories with their owner, name, description, ' +
		'and html_url. Use this to discover the owner/repo pair when the ' +
		'user gives you a URL or a name but you are not sure of the exact ' +
		'owner login. Paginated.',
	inputSchema: objectSchema(
		{
			query: {
				type: 'string',
				description: 'Search query (matches repo name, owner, or description)',
				minLength: 1,
			},
			limit: limitSchema,
		},
		['query'],
	),
	async handler({ args, client }): Promise<unknown> {
		const query = String(args['query'] ?? '').trim();
		if (!query) {
			throw new Error("'query' must not be empty");
		}
		const limit = args['limit'] !== undefined ? resolveNumber({ n: args['limit'] }, 'n') : 30;
		return client.rawRequest('GET', `/repos/search?q=${encodeURIComponent(query)}&limit=${limit}`);
	},
};
