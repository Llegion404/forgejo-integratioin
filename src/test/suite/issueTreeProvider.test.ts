import * as assert from 'assert';
import * as vscode from 'vscode';
import { IssueTreeProvider } from '../../providers/issueTreeProvider';

suite('Issue Tree Provider Test Suite', () => {
  let provider: IssueTreeProvider;

  setup(() => {
    provider = new IssueTreeProvider();
  });

  test('Provider should be created', () => {
    assert.ok(provider, 'Provider should be created');
  });

  test('Provider should implement TreeDataProvider', () => {
    assert.ok(provider.getTreeItem, 'Should have getTreeItem method');
    assert.ok(provider.getChildren, 'Should have getChildren method');
    assert.ok(provider.onDidChangeTreeData, 'Should have onDidChangeTreeData event');
  });

  test('Provider should have refresh method', () => {
    assert.strictEqual(typeof provider.refresh, 'function', 'Should have refresh method');
  });

  test('Refresh should trigger onDidChangeTreeData event', (done) => {
    const disposable = provider.onDidChangeTreeData(() => {
      disposable.dispose();
      done();
    });

    provider.refresh();
  });

  test('getChildren should return array for root', async function() {
    this.timeout(10000);

    const children = await provider.getChildren();
    assert.ok(Array.isArray(children), 'Should return an array');
  });

  test('getChildren should handle no configuration gracefully', async function() {
    this.timeout(10000);

    const children = await provider.getChildren();

    // When there's no config, it should return a message item
    assert.ok(children.length > 0, 'Should return at least one item');

    // The first item should be a message (error or info)
    const firstItem = children[0];
    assert.ok(firstItem, 'First item should exist');
    assert.ok(
      firstItem.contextValue === 'error' || firstItem.contextValue === 'info',
      'Should return message item when no config'
    );
  });

  test('getTreeItem should return the same item', () => {
    const item = new vscode.TreeItem('Test', vscode.TreeItemCollapsibleState.None);
    const result = provider.getTreeItem(item as any);
    assert.strictEqual(result, item, 'Should return the same tree item');
  });

  test('Provider should handle errors gracefully', async function() {
    this.timeout(10000);

    // Even with errors, getChildren should not throw
    try {
      const children = await provider.getChildren();
      assert.ok(true, 'Should not throw on errors');
      assert.ok(Array.isArray(children), 'Should still return an array');
    } catch (error) {
      assert.fail(`Should not throw error: ${error}`);
    }
  });
});
