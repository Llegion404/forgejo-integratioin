import * as vscode from 'vscode';
import { getForgejoConfig } from '../utils/config';
import { getAllInstances } from '../utils/instanceHelpers';

/**
 * Status-bar item showing the currently-active Forgejo instance + repo.
 *
 * Click → executes `forgejo.switchInstance` to bring up the quick pick.
 *
 * B4.4 — keeps multi-instance users oriented without taking focus away from
 * the editor.
 */
export class InstanceStatusBar implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private _pollHandle?: NodeJS.Timeout;

  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this._item.command = 'forgejo.switchInstance';
    this._item.tooltip = 'Forgejo: switch active instance';
    this._item.name = 'Forgejo Instance';
    this._item.text = '$(server) Forgejo';
    this._item.show();
    void this.refresh();
    // Re-sync every 30s in case the user changes instances via settings or git remote
    this._pollHandle = setInterval(() => { void this.refresh(); }, 30_000);
  }

  public async refresh(): Promise<void> {
    try {
      const config = await getForgejoConfig();
      if (!config) {
        this._item.text = '$(server) Forgejo: not configured';
        return;
      }
      const instances = await getAllInstances();
      const match = instances.find(i => i.instanceUrl === config.instanceUrl);
      const name = match?.name ?? config.instanceUrl.replace(/^https?:\/\//, '');
      this._item.text = `$(server) ${name}: ${config.owner}/${config.repo}`;
      this._item.tooltip = `${name}\n${config.instanceUrl}/${config.owner}/${config.repo}\n\nClick to switch active instance`;
    } catch {
      // ignore — keep last text
    }
  }

  public dispose(): void {
    if (this._pollHandle) {
      clearInterval(this._pollHandle);
      this._pollHandle = undefined;
    }
    this._item.dispose();
  }
}

export function createInstanceStatusBar(): InstanceStatusBar {
  return new InstanceStatusBar();
}
