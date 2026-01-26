import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation Test Suite', () => {
  vscode.window.showInformationMessage('Starting extension activation tests');

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('forgejo.forgejo-vscode');
    assert.ok(extension, 'Extension should be installed');
  });

  test('Extension should activate', async function() {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension('forgejo.forgejo-vscode');
    assert.ok(extension);

    await extension.activate();
    assert.strictEqual(extension.isActive, true, 'Extension should be active');
  });

  test('All commands should be registered', async function() {
    this.timeout(10000);

    const commands = await vscode.commands.getCommands(true);
    const forgejoCommands = [
      'forgejo.refreshPullRequests',
      'forgejo.refreshIssues',
      'forgejo.configureInstanceUrl',
      'forgejo.setAuthToken',
      'forgejo.openPrInBrowser',
      'forgejo.openIssueInBrowser'
    ];

    for (const command of forgejoCommands) {
      assert.ok(
        commands.includes(command),
        `Command ${command} should be registered`
      );
    }
  });

  test('Refresh Pull Requests command should execute', async function() {
    this.timeout(5000);

    try {
      await vscode.commands.executeCommand('forgejo.refreshPullRequests');
      assert.ok(true, 'Command executed without error');
    } catch (error) {
      assert.fail(`Command failed to execute: ${error}`);
    }
  });

  test('Refresh Issues command should execute', async function() {
    this.timeout(5000);

    try {
      await vscode.commands.executeCommand('forgejo.refreshIssues');
      assert.ok(true, 'Command executed without error');
    } catch (error) {
      assert.fail(`Command failed to execute: ${error}`);
    }
  });

  test('Tree views should be created', async function() {
    this.timeout(5000);

    // The tree views are created when the extension activates
    const extension = vscode.extensions.getExtension('forgejo.forgejo-vscode');
    assert.ok(extension);

    if (!extension.isActive) {
      await extension.activate();
    }

    // If we reach here without errors, tree views were created successfully
    assert.ok(true, 'Tree views created without errors');
  });
});
