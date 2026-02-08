import { test as base, expect } from '@mshanemc/vscode-test-playwright';
import type { Page } from '@playwright/test';

/**
 * VSCodeHarness encapsulates common VS Code UI interactions
 * for the Forgejo extension e2e tests.
 */
export class VSCodeHarness {
  constructor(
    private workbox: Page,
    private evaluateInVSCode: <R>(fn: (vscode: typeof import('vscode')) => R | Promise<R>) => Promise<R>,
  ) {}

  /** Wait for the Forgejo sidebar to be available (extension activated). */
  async waitForExtensionActivation(timeout = 30_000): Promise<void> {
    // Wait for the activity bar icon with Forgejo tooltip to appear
    const activityBar = this.workbox.locator('[id="workbench.view.extension.forgejoExplorer"]');
    await activityBar.waitFor({ state: 'attached', timeout });
  }

  /** Click the Forgejo icon in the activity bar to open the sidebar. */
  async openForgejoSidebar(): Promise<void> {
    const activityBarItem = this.workbox.locator(
      '.action-item a[aria-label="Forgejo"]'
    );
    // If not already active, click it
    const isActive = await activityBarItem.evaluate(
      (el) => el.classList.contains('checked')
    ).catch(() => false);
    if (!isActive) {
      await activityBarItem.click();
    }
    // Wait for the sidebar content to be visible
    await this.workbox.locator('.pane-header [title="Pull Requests"]').waitFor({ state: 'visible', timeout: 10_000 });
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
    await this.evaluateInVSCode(async (vscode) => {
      await vscode.commands.executeCommand(commandId);
    });
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
    return await this.evaluateInVSCode(async (vscode) => {
      const all = await vscode.commands.getCommands(true);
      return all.filter((cmd: string) => cmd.startsWith(prefix));
    });
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
