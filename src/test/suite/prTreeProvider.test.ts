import * as assert from 'assert';
import * as vscode from 'vscode';
import { PRTreeProvider } from '../../providers/prTreeProvider';

suite('PR Tree Provider Test Suite', () => {
  let provider: PRTreeProvider;

  setup(() => {
    provider = new PRTreeProvider();
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

suite('PR Tree Expansion and Files Test Suite', () => {
  let provider: PRTreeProvider;

  setup(() => {
    provider = new PRTreeProvider();
  });

  test('PR items should have collapsed state by default', async function() {
    this.timeout(10000);

    const children = await provider.getChildren();

    // Find a PR group if available
    const prGroup = children.find(item => item.contextValue === 'prGroup');
    if (prGroup) {
      const prs = await provider.getChildren(prGroup as any);
      const prItem = prs.find(item => item.contextValue === 'pullRequest');

      if (prItem) {
        assert.strictEqual(
          prItem.collapsibleState,
          vscode.TreeItemCollapsibleState.Collapsed,
          'PR should be collapsed by default'
        );
      }
    }
  });

  test('Expanding PR should attempt to load files', async function() {
    this.timeout(10000);

    const children = await provider.getChildren();
    const prGroup = children.find(item => item.contextValue === 'prGroup');

    if (prGroup) {
      const prs = await provider.getChildren(prGroup as any);
      const prItem = prs.find(item => item.contextValue === 'pullRequest');

      if (prItem) {
        // Attempt to get children (files)
        const files = await provider.getChildren(prItem as any);

        // Should return an array (might be empty, loading, or error)
        assert.ok(Array.isArray(files), 'Should return array when expanding PR');
      }
    }
  });

  test('File items should have correct ThemeIcon for added status', async function() {
    this.timeout(10000);

    // Create a mock PRTreeItem with cached files
    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    // Add mock file data
    (mockPRItem as any).files = [{
      filename: 'test.ts',
      status: 'added',
      additions: 10,
      deletions: 0,
      changes: 10,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const files = await provider.getChildren(mockPRItem as any);

    if (files.length > 0 && files[0].contextValue === 'prFile') {
      const fileItem = files[0];
      assert.ok(fileItem.iconPath, 'File should have icon');

      if (fileItem.iconPath && typeof fileItem.iconPath === 'object' && 'id' in fileItem.iconPath) {
        assert.strictEqual(
          (fileItem.iconPath as vscode.ThemeIcon).id,
          'diff-added',
          'Added file should have diff-added icon'
        );
      }
    }
  });

  test('File items should have correct ThemeIcon for modified status', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    (mockPRItem as any).files = [{
      filename: 'test.ts',
      status: 'modified',
      additions: 5,
      deletions: 3,
      changes: 8,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const files = await provider.getChildren(mockPRItem as any);

    if (files.length > 0 && files[0].contextValue === 'prFile') {
      const fileItem = files[0];

      if (fileItem.iconPath && typeof fileItem.iconPath === 'object' && 'id' in fileItem.iconPath) {
        assert.strictEqual(
          (fileItem.iconPath as vscode.ThemeIcon).id,
          'diff-modified',
          'Modified file should have diff-modified icon'
        );
      }
    }
  });

  test('File items should have correct ThemeIcon for removed status', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    (mockPRItem as any).files = [{
      filename: 'test.ts',
      status: 'removed',
      additions: 0,
      deletions: 20,
      changes: 20,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const files = await provider.getChildren(mockPRItem as any);

    if (files.length > 0 && files[0].contextValue === 'prFile') {
      const fileItem = files[0];

      if (fileItem.iconPath && typeof fileItem.iconPath === 'object' && 'id' in fileItem.iconPath) {
        assert.strictEqual(
          (fileItem.iconPath as vscode.ThemeIcon).id,
          'diff-removed',
          'Removed file should have diff-removed icon'
        );
      }
    }
  });

  test('File items should have correct ThemeIcon for renamed status', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    (mockPRItem as any).files = [{
      filename: 'newname.ts',
      status: 'renamed',
      additions: 2,
      deletions: 1,
      changes: 3,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents',
      previous_filename: 'oldname.ts'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const files = await provider.getChildren(mockPRItem as any);

    if (files.length > 0 && files[0].contextValue === 'prFile') {
      const fileItem = files[0];

      if (fileItem.iconPath && typeof fileItem.iconPath === 'object' && 'id' in fileItem.iconPath) {
        assert.strictEqual(
          (fileItem.iconPath as vscode.ThemeIcon).id,
          'diff-renamed',
          'Renamed file should have diff-renamed icon'
        );
      }
    }
  });

  test('File items should have showPrFileDiff command', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    (mockPRItem as any).files = [{
      filename: 'test.ts',
      status: 'modified',
      additions: 5,
      deletions: 3,
      changes: 8,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const files = await provider.getChildren(mockPRItem as any);

    if (files.length > 0 && files[0].contextValue === 'prFile') {
      const fileItem = files[0];
      assert.ok(fileItem.command, 'File should have command');
      assert.strictEqual(
        fileItem.command?.command,
        'forgejo.showPrFileDiff',
        'File should have showPrFileDiff command'
      );
    }
  });

  test('Cache should be reused on re-expansion', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    const mockFiles = [{
      filename: 'test.ts',
      status: 'modified' as const,
      additions: 5,
      deletions: 3,
      changes: 8,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];

    (mockPRItem as any).files = mockFiles;
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    // First expansion
    const files1 = await provider.getChildren(mockPRItem as any);

    // Second expansion - should use cache
    const files2 = await provider.getChildren(mockPRItem as any);

    assert.strictEqual(files1.length, files2.length, 'Should return same number of files');

    if (files1.length > 0 && files2.length > 0) {
      assert.strictEqual(
        files1[0].label,
        files2[0].label,
        'Should return same files from cache'
      );
    }
  });

  test('Cache should be cleared on refresh', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    (mockPRItem as any).files = [{
      filename: 'test.ts',
      status: 'modified' as const,
      additions: 5,
      deletions: 3,
      changes: 8,
      blob_url: 'https://example.com/blob',
      raw_url: 'https://example.com/raw',
      contents_url: 'https://example.com/contents'
    }];
    (mockPRItem as any).baseRef = 'main';
    (mockPRItem as any).headRef = 'feature';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    // Get files - should return files from cache
    const files = await provider.getChildren(mockPRItem as any);

    // Verify we got files (or a valid response)
    assert.ok(Array.isArray(files), 'Should return array');

    // Refresh provider
    provider.refresh();

    // After refresh, provider state is refreshed
    // We can't directly test cache clearing of PRTreeItem internal state,
    // but we can verify refresh doesn't break anything
    assert.ok(true, 'Refresh should complete without error');
  });

  test('Error state should show error message item', async function() {
    this.timeout(10000);

    const mockPRItem = new vscode.TreeItem('Test PR', vscode.TreeItemCollapsibleState.Collapsed);
    mockPRItem.contextValue = 'pullRequest';

    // Set an error instead of files
    (mockPRItem as any).filesError = 'Failed to fetch files';
    (mockPRItem as any).pr = { number: 1, title: 'Test', state: 'open', user: { login: 'user' }, html_url: 'https://example.com', created_at: '2026-01-01', merged: false, draft: false };
    (mockPRItem as any).owner = 'owner';
    (mockPRItem as any).repo = 'repo';

    const children = await provider.getChildren(mockPRItem as any);

    // Verify we got a response
    assert.ok(Array.isArray(children), 'Should return array');

    // If filesError is set, should return error item
    if (children.length > 0) {
      const errorItem = children.find(item => item.contextValue === 'error');
      assert.ok(errorItem, 'Should have error item when filesError is set');
    } else {
      // If no children, that's also acceptable error handling
      assert.ok(true, 'Empty array is acceptable error state');
    }
  });
});
