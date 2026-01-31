# Known Bugs - Forgejo VSCode Extension

This file documents bugs found in the codebase for the next agent to fix.

## Bug 1: Error Messages Not Shown to Users

**Location:** `src/providers/prTreeProvider.ts:177-180` and `src/providers/issueTreeProvider.ts:105-108`

**Problem:** When an error occurs in `getChildren()`, the code sets `this.error` but then returns an empty array `[]` instead of the error message. Users will see nothing instead of the error.

**Current Code (prTreeProvider.ts:177-180):**
```typescript
} catch (error) {
  this.error = error instanceof Error ? error.message : 'Unknown error';
  return [];  // BUG: Should return [new PRMessageItem(this.error, true)]
}
```

**Current Code (issueTreeProvider.ts:105-108):**
```typescript
} catch (error) {
  this.error = error instanceof Error ? error.message : 'Unknown error';
  return [];  // BUG: Should return [new IssueMessageItem(this.error, true)]
}
```

**Fix:** Return the error message item instead of empty array:
```typescript
} catch (error) {
  this.error = error instanceof Error ? error.message : 'Unknown error';
  return [new PRMessageItem(this.error, true)];  // or IssueMessageItem
}
```

---

## Bug 2: Async/Await in Array.filter() Race Condition

**Location:** `src/utils/instanceHelpers.ts:54-74`

**Problem:** The `getAllInstances()` function uses `await` inside an `Array.filter()` callback. This doesn't work properly because `filter()` is synchronous and doesn't wait for async operations. The cleanup of invalid instances may not complete before the function returns.

**Current Code (instanceHelpers.ts:59-71):**
```typescript
// Filter and validate instances
const validInstances = instances.filter(instance => {
  const valid = isValidInstance(instance);
  if (!valid) {
    logWarn('Found and skipped invalid instance:', instance);  // This is async!
  }
  return valid;
});

// If we filtered out any invalid instances, save the cleaned list
if (validInstances.length !== instances.length && instances.length > 0) {
  logInfo(`Cleaned up ${instances.length - validInstances.length} invalid instance(s)`);  // This is async!
  await config.update('instances', validInstances, vscode.ConfigurationTarget.Global);  // This may not execute properly
}
```

**Fix:** Use a for...of loop or Promise.all to properly handle async operations:
```typescript
export async function getAllInstances(): Promise<ForgejoInstance[]> {
  const config = vscode.workspace.getConfiguration('forgejo');
  const instances = config.get<any[]>('instances', []);

  // Filter and validate instances (synchronous)
  const validInstances: ForgejoInstance[] = [];
  const invalidInstances: any[] = [];
  
  for (const instance of instances) {
    if (isValidInstance(instance)) {
      validInstances.push(instance);
    } else {
      invalidInstances.push(instance);
    }
  }

  // Log invalid instances
  for (const instance of invalidInstances) {
    logWarn('Found and skipped invalid instance:', instance);
  }

  // If we filtered out any invalid instances, save the cleaned list
  if (validInstances.length !== instances.length && instances.length > 0) {
    logInfo(`Cleaned up ${instances.length - validInstances.length} invalid instance(s)`);
    await config.update('instances', validInstances, vscode.ConfigurationTarget.Global);
  }

  return validInstances;
}
```

---

## Bug 3: Logger Fails in Tests Due to Missing Mock

**Location:** `src/utils/logger.ts:13-16`

**Problem:** The logger tries to create an output channel when running in tests, but `vscode.window.createOutputChannel` is not mocked in the test setup. This causes tests to fail with "TypeError: vscode.window.createOutputChannel is not a function".

**Current Code (logger.ts:13-16):**
```typescript
private getOutputChannel(): vscode.OutputChannel {
  if (!this.outputChannel) {
    this.outputChannel = vscode.window.createOutputChannel('Forgejo');  // Fails in tests!
    // ...
  }
  return this.outputChannel;
}
```

**Fix Options:**

**Option A - Add test environment check:**
```typescript
private getOutputChannel(): vscode.OutputChannel | undefined {
  if (!this.outputChannel) {
    // Check if we're in a test environment
    if (typeof vscode.window.createOutputChannel !== 'function') {
      return undefined;
    }
    this.outputChannel = vscode.window.createOutputChannel('Forgejo');
    // ...
  }
  return this.outputChannel;
}
```

**Option B - Update test setup file:**
Add to `src/__tests__/setup.ts`:
```typescript
(vscode.window as any).createOutputChannel = jest.fn(() => ({
  appendLine: jest.fn(),
  show: jest.fn(),
  dispose: jest.fn(),
}));
```

**Option C - Both:**
Implement Option A for defensive coding AND Option B for proper test coverage.

---

## Bug 4: Code Duplication - Functions Defined Twice

**Location:** 
- `src/utils/migration.ts:42-58` (getDefaultInstanceName)
- `src/utils/migration.ts:63-75` (normalizeUrl)
- `src/utils/instanceHelpers.ts:310-326` (getDefaultInstanceName)
- `src/utils/instanceHelpers.ts:20-32` (normalizeUrl)

**Problem:** The same `normalizeUrl()` and `getDefaultInstanceName()` functions are defined in both `migration.ts` and `instanceHelpers.ts`. This creates maintenance issues and potential inconsistencies.

**Fix:** Export these functions from `instanceHelpers.ts` and import them in `migration.ts`. Remove the duplicate definitions from `migration.ts`.

In `instanceHelpers.ts`:
- Ensure `normalizeUrl` and `getDefaultInstanceName` are exported (they already are)

In `migration.ts`:
```typescript
import { generateUUID, normalizeUrl, getDefaultInstanceName } from './instanceHelpers';

// Remove the duplicate function definitions
```

---

## Bug 5: Missing EventEmitter Disposal (Memory Leak)

**Location:** `src/providers/prDiffContentProvider.ts:16`

**Problem:** The `_onDidChange` EventEmitter is created but never disposed. In VS Code extensions, this can cause memory leaks when the extension is deactivated or when the provider is no longer needed.

**Current Code (prDiffContentProvider.ts:14-18):**
```typescript
export class PRDiffContentProvider implements vscode.TextDocumentContentProvider {
  private cache: Map<string, string> = new Map();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();  // Never disposed!
  readonly onDidChange = this._onDidChange.event;
```

**Fix:** Add a dispose method and ensure it's called when the extension deactivates:
```typescript
export class PRDiffContentProvider implements vscode.TextDocumentContentProvider {
  private cache: Map<string, string> = new Map();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(this._onDidChange);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.cache.clear();
  }
  
  // ... rest of the class
}
```

Then in `extension.ts`, add the provider to subscriptions:
```typescript
const prDiffProvider = new PRDiffContentProvider();
context.subscriptions.push(
  vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, prDiffProvider),
  prDiffProvider  // Add this to ensure disposal
);
```

---

## Bug 6: Test Expectation Mismatch in removeInstance

**Location:** `src/__tests__/utils/instanceHelpers.test.ts:210`

**Problem:** The test expects `update` to have been called only with the instances array, but `removeInstance()` also calls `syncToLegacySettings()` which updates the legacy config. This causes 4 calls instead of the expected 2.

**Current Test Code (instanceHelpers.test.ts:208-214):**
```typescript
// Second call to update sets the new default
expect(update).toHaveBeenLastCalledWith(
  'instances',
  [expect.objectContaining({ ...instance2, isDefault: true })],
  vscode.ConfigurationTarget.Global
);
```

**Current Implementation (instanceHelpers.ts:165-178):**
```typescript
export async function removeInstance(id: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forgejo');
  const instances = await getAllInstances();

  const filtered = instances.filter(i => i.id !== id);
  await config.update('instances', filtered, vscode.ConfigurationTarget.Global);

  // If we removed the default, make the first remaining instance default
  if (filtered.length > 0 && !filtered.some(i => i.isDefault)) {
    filtered[0].isDefault = true;
    await config.update('instances', filtered, vscode.ConfigurationTarget.Global);  // 2nd call
    await syncToLegacySettings(filtered[0]);  // 3rd and 4th calls (instanceUrl and token)
  }
}
```

**Fix:** Either:
1. Update the test to expect all 4 calls (2 for instances, 2 for legacy settings)
2. Or batch the legacy settings updates into a single call
3. Or use `toHaveBeenCalledWith` multiple times instead of `toHaveBeenLastCalledWith`

Recommended fix - update test:
```typescript
// Should have 4 calls: 2 for instances, 2 for legacy settings
expect(update).toHaveBeenCalledTimes(4);
expect(update).toHaveBeenNthCalledWith(
  2,  // Second call is the second instances update
  'instances',
  [expect.objectContaining({ ...instance2, isDefault: true })],
  vscode.ConfigurationTarget.Global
);
```

---

## Bug 7: File Status Lookup Safety

**Location:** `src/providers/prTreeProvider.ts:245-248`

**Problem:** The `statusOrder` lookup assumes all file statuses will be in the map. If the API returns an unexpected status, the sort order may be unpredictable.

**Current Code (prTreeProvider.ts:245-248):**
```typescript
const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
const sortedFiles = files.sort((a, b) => {
  return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
});
```

**Problem:** The code already has a fallback to 99, but this could still cause issues if multiple unknown statuses exist. Also, the type safety could be improved.

**Fix:** This is actually handled reasonably well with the `|| 99` fallback, but we could make it more explicit:
```typescript
const statusOrder: Record<string, number> = { added: 0, modified: 1, renamed: 2, removed: 3 };
const getStatusPriority = (status: string): number => statusOrder[status] ?? 99;
const sortedFiles = files.sort((a, b) => getStatusPriority(a.status) - getStatusPriority(b.status));
```

This is a minor improvement for readability and type safety.

---

## Priority Order for Fixes:

1. **Bug 1** (Error messages not shown) - HIGH - User-facing bug
2. **Bug 3** (Logger test failures) - HIGH - Blocking tests
3. **Bug 2** (Async filter race condition) - MEDIUM - Potential data inconsistency
4. **Bug 6** (Test expectation) - MEDIUM - Test reliability
5. **Bug 4** (Code duplication) - LOW - Code quality
6. **Bug 5** (Memory leak) - LOW - Resource cleanup
7. **Bug 7** (File status lookup) - LOW - Defensive coding

---

## Files to Modify:

1. `src/providers/prTreeProvider.ts` - Bug 1, Bug 7
2. `src/providers/issueTreeProvider.ts` - Bug 1
3. `src/utils/instanceHelpers.ts` - Bug 2, Bug 4 (remove duplicates)
4. `src/utils/migration.ts` - Bug 4 (import instead of define)
5. `src/utils/logger.ts` - Bug 3
6. `src/providers/prDiffContentProvider.ts` - Bug 5
7. `src/extension.ts` - Bug 5 (add to subscriptions)
8. `src/__tests__/utils/instanceHelpers.test.ts` - Bug 6
9. `src/__tests__/setup.ts` - Bug 3 (if implementing Option B)

---

## Testing After Fixes:

Run the following to verify fixes:
```bash
npm run test:unit
npm run lint
```

Make sure all tests pass and no new linting errors are introduced.
