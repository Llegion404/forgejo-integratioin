/**
 * Aggregate every MCP tool the server exposes.
 *
 * Add new tool groups here. The v1 surface was read-only issues/PRs/CI;
 * v2 added workflows, search, and repo navigation (branches/commits/compare)
 * — all still read-only per the user's decision to keep the server safe.
 *
 * Total: 40 tools across 11 groups.
 */

import { Tool } from './framework';
import { listInstancesTool, getCurrentUserTool } from './meta';
import { searchRepositoriesTool } from './repositories';
import { issueTools } from './issues';
import { pullRequestTools } from './pullRequests';
import { ciStatusTools } from './ciStatus';
import { reactionTools } from './reactions';
import { branchProtectionTools } from './branchProtection';
import { miscTools } from './misc';
import { attachmentTools } from './attachments';
import { workflowTools } from './workflows';
import { searchTools } from './search';
import { repoTools } from './repo';

export { Tool, ImageToolResult } from './framework';
export * from './meta';
export * from './repositories';
export * from './issues';
export * from './pullRequests';
export * from './ciStatus';
export * from './reactions';
export * from './branchProtection';
export * from './misc';
export * from './attachments';
export * from './workflows';
export * from './search';
export * from './repo';

export const ALL_TOOLS: Tool[] = [
	listInstancesTool,
	getCurrentUserTool,
	searchRepositoriesTool,
	...issueTools,
	...pullRequestTools,
	...ciStatusTools,
	...reactionTools,
	...branchProtectionTools,
	...miscTools,
	...attachmentTools,
	...workflowTools,
	...searchTools,
	...repoTools,
];

/** Find a tool by name. Returns undefined if not registered. */
export function findTool(name: string): Tool | undefined {
	return ALL_TOOLS.find((t) => t.name === name);
}
