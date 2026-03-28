/**
 * Type-safe command registry for Forgejo VS Code extension.
 *
 * VS Code's `registerCommand` and `executeCommand` use `any` for arguments,
 * so TypeScript cannot verify that callers and handlers agree on types.
 * This module provides a central `CommandMap` that defines the expected
 * argument tuple for every command, plus typed wrappers that enforce it
 * at compile time.
 *
 * Context menu invocation: when a command appears in package.json under
 * `view/item/context`, VS Code passes the tree item as the first argument.
 * Handlers for those commands must accept the tree item type in their
 * first parameter (reflected in the CommandMap via union types).
 */

import * as vscode from 'vscode';
import type { PullRequestListItem, PullRequestFile } from '../models/pullRequest';
import type { WorkflowRunListItem, WorkflowJob } from '../models/action';
import type { IssueListItem } from '../models/issue';
import type { WorkflowRunTreeItem, JobTreeItem, StepTreeItem, StepLogArgs } from '../providers/actionsTreeProvider';

// ---------------------------------------------------------------------------
// Command argument map
// ---------------------------------------------------------------------------

/**
 * Maps every `forgejo.*` command ID to its expected argument tuple.
 *
 * Commands invoked from `view/item/context` receive a tree item as arg 0.
 * Those entries should use a union type for arg 0 so both the context-menu
 * path (tree item) and the direct-invocation path (data object) compile.
 */
export interface CommandMap {
  // -- No-arg commands (toolbar buttons, palette, etc.) --------------------
  'forgejo.addInstance': [];
  'forgejo.manageInstances': [];
  'forgejo.showDiagnostics': [];
  'forgejo.showOutput': [];
  'forgejo.refreshPullRequests': [];
  'forgejo.refreshIssues': [];
  'forgejo.refreshActions': [];
  'forgejo.refreshReleases': [];
  'forgejo.configureInstanceUrl': [];
  'forgejo.setAuthToken': [];
  'forgejo.selectRemote': [];
  'forgejo.createIssue': [];
  'forgejo.createPullRequest': [];
  'forgejo.createRelease': [];

  // -- Simple URL commands -------------------------------------------------
  'forgejo.openPrInBrowser': [url: string];
  'forgejo.openIssueInBrowser': [url: string];
  'forgejo.openReleaseInBrowser': [url: string];
  'forgejo.openActionInBrowserDirect': [url: string];

  // -- Inline comment ------------------------------------------------------
  'forgejo.submitInlineComment': [reply: vscode.CommentReply];

  // -- PR file diff (TreeItem.command only) --------------------------------
  'forgejo.showPrFileDiff': [
    file: PullRequestFile,
    pr: PullRequestListItem,
    owner: string,
    repo: string,
    baseRef: string,
    headRef: string,
  ];

  // -- Context menu commands -----------------------------------------------
  // NOTE: commands registered in package.json `view/item/context` receive
  // the tree item as arg 0. Entries below that don't yet include the tree
  // item type are known-broken for context menu invocation and should be
  // fixed to use union types (see showActionDetails for an example).

  'forgejo.openPrInBrowserFromContext': [prItem: unknown];
  'forgejo.openPrFileInBrowser': [fileItem: unknown];

  'forgejo.showPrDetails': [pr: PullRequestListItem, owner: string, repo: string];
  'forgejo.mergePr': [pr: PullRequestListItem, owner: string, repo: string];
  'forgejo.closePr': [pr: PullRequestListItem, owner: string, repo: string];
  'forgejo.showIssueDetails': [issue: IssueListItem, owner: string, repo: string];
  'forgejo.openIssueInBrowserFromContext': [issueItem: unknown];

  'forgejo.showActionDetails': [run: WorkflowRunListItem, owner: string, repo: string];
  'forgejo.viewActionLogs': [run: WorkflowRunListItem, job: WorkflowJob, owner: string, repo: string];

  'forgejo.openActionInBrowser': [item: WorkflowRunTreeItem | JobTreeItem | StepTreeItem];
  'forgejo.rerunAction': [item: WorkflowRunTreeItem | JobTreeItem];

  'forgejo.viewStepLogs': [args: StepLogArgs];
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Type-safe wrapper around `vscode.commands.registerCommand`.
 *
 * Ensures the handler signature matches what `CommandMap` declares for the
 * given command ID. This catches mismatches at compile time — if you change
 * the command's context menu `when` clause to target a new tree item type,
 * the compiler will force you to update the handler.
 */
export function registerCommand<K extends keyof CommandMap>(
  id: K,
  handler: (...args: CommandMap[K]) => void | Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    id,
    handler as (...args: unknown[]) => unknown,
  );
}

/**
 * Type-safe wrapper around `vscode.commands.executeCommand`.
 *
 * Ensures call-site arguments match what the handler expects.
 */
export function executeCommand<K extends keyof CommandMap>(
  id: K,
  ...args: CommandMap[K]
): Thenable<unknown> {
  return vscode.commands.executeCommand(id, ...args);
}
