import { test as base, expect } from '@mshanemc/vscode-test-playwright';
import type { Page } from '@playwright/test';

/**
 * VSCodeHarness encapsulates common VS Code UI interactions
 * for the Forgejo extension e2e tests.
 */
export class VSCodeHarness {
  constructor(
    private workbox: Page,
    private evaluateInVSCode: <R>(fn: (vscode: typeof import('vscode'), ...args: any[]) => R | Promise<R>, arg?: any) => Promise<R>,
  ) {}

  /** Wait for the Forgejo extension to be active. */
  async waitForExtensionActivation(timeout = 30_000): Promise<void> {
    // Poll via evaluateInVSCode until the extension is active
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const isActive = await this.evaluateInVSCode((vscode) => {
        const ext = vscode.extensions.getExtension('maxking.forgejo-vscode');
        return ext?.isActive ?? false;
      });
      if (isActive) return;
      // Wait a bit before polling again
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Extension did not activate within ${timeout}ms`);
  }

  /** Click the Forgejo icon in the activity bar to open the sidebar. */
  async openForgejoSidebar(): Promise<void> {
    // Use the VS Code command to open the Forgejo sidebar
    await this.evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand('workbench.view.extension.forgejoExplorer');
    });
    // Give the sidebar a moment to render
    await new Promise(r => setTimeout(r, 1000));
  }

  /** Get tree item labels from a view. */
  async getTreeItems(viewId: string): Promise<string[]> {
    const items = await this.evaluateInVSCode(async (vscode) => {
      // There's no direct API to read tree items, but we can check commands
      // Instead, we'll read the UI
      return [] as string[];
    });

    // Use Playwright to scrape the tree view items from the DOM
    const treeRows = this.workbox.locator(
      `[id="${viewId}"] .monaco-list-row .label-name`
    );
    const count = await treeRows.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await treeRows.nth(i).textContent();
      if (text) {
        labels.push(text.trim());
      }
    }
    return labels;
  }

  /** Execute a VS Code command by ID. */
  async executeCommand(commandId: string, ...args: unknown[]): Promise<void> {
    await this.evaluateInVSCode(async (vscode, cmdId: string) => {
      await vscode.commands.executeCommand(cmdId);
    }, commandId);
  }

  /** Get visible notification messages. */
  async getNotifications(): Promise<string[]> {
    const notifications = this.workbox.locator('.notification-toast .notification-list-item-message');
    const count = await notifications.count();
    const messages: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await notifications.nth(i).textContent();
      if (text) {
        messages.push(text.trim());
      }
    }
    return messages;
  }

  /** Take a named screenshot for debugging / agent feedback. */
  async captureScreenshot(name: string): Promise<Buffer> {
    return await this.workbox.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  /** Get the list of registered extension commands matching a prefix. */
  async getRegisteredCommands(prefix: string): Promise<string[]> {
    return await this.evaluateInVSCode(async (vscode, pfx: string) => {
      const all = await vscode.commands.getCommands(true);
      return all.filter((cmd: string) => cmd.startsWith(pfx));
    }, prefix);
  }

  /** Check if the extension is active. */
  async isExtensionActive(): Promise<boolean> {
    return await this.evaluateInVSCode((vscode) => {
      const ext = vscode.extensions.getExtension('maxking.forgejo-vscode');
      return ext?.isActive ?? false;
    });
  }
}

/**
 * Extended test fixture that includes the VSCodeHarness.
 */
export const test = base.extend<{ harness: VSCodeHarness }>({
  harness: async ({ workbox, evaluateInVSCode }, use) => {
    const harness = new VSCodeHarness(workbox, evaluateInVSCode);
    await use(harness);
  },
});

export { expect };
