/**
 * Aggregate every MCP tool the server exposes.
 *
 * Add new tool groups here. To ship v2 write actions (create_issue,
 * create_pull_request, comment_on_issue, merge_pr, close_pr, submit_review,
 * add_label, assign, etc.), append a new file like `tools/writeActions.ts`
 * and concatenate its exports to ALL_TOOLS — no other server changes needed.
 */

import { Tool } from './framework';
import { listInstancesTool, getCurrentUserTool } from './meta';
import { searchRepositoriesTool } from './repositories';
import { issueTools } from './issues';
import { pullRequestTools } from './pullRequests';
import { getPullRequestSummaryTool } from './pullRequestSummary';
import { ciStatusTools } from './ciStatus';
import { reactionTools } from './reactions';
import { branchProtectionTools } from './branchProtection';
import { miscTools } from './misc';
import { attachmentTools } from './attachments';

export { Tool, ImageToolResult } from './framework';
export * from './meta';
export * from './repositories';
export * from './issues';
export * from './pullRequests';
export * from './pullRequestSummary';
export * from './ciStatus';
export * from './reactions';
export * from './branchProtection';
export * from './misc';
export * from './attachments';

export const ALL_TOOLS: Tool[] = [
	listInstancesTool,
	getCurrentUserTool,
	searchRepositoriesTool,
	...issueTools,
	...pullRequestTools,
	getPullRequestSummaryTool,
	...ciStatusTools,
	...reactionTools,
	...branchProtectionTools,
	...miscTools,
	...attachmentTools,
];

/** Find a tool by name. Returns undefined if not registered. */
export function findTool(name: string): Tool | undefined {
	return ALL_TOOLS.find((t) => t.name === name);
}
