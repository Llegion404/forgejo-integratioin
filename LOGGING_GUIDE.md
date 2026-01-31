# Forgejo Extension Logging Guide

## Overview

The Forgejo extension now uses VS Code's native Output API for all logging instead of console.log. This provides a better user experience with easier access to logs.

## How to View Logs

### Method 1: Command Palette
1. Press `Cmd+Shift+P` / `Ctrl+Shift+P`
2. Run: **`Forgejo: Show Output Channel`**
3. The Output panel opens with Forgejo logs

### Method 2: Output Panel
1. Open the Output panel: `View` → `Output` (or `Cmd+Shift+U`)
2. In the dropdown, select **"Forgejo"**

### Method 3: After Success Message
When you successfully add an instance, click the **"Show Output"** button in the notification.

## Log Levels

The extension uses 4 log levels:

| Level | When Used | Example |
|-------|-----------|---------|
| **INFO** | Normal operations | Instance added, config loaded |
| **WARN** | Recoverable issues | Invalid instance skipped |
| **ERROR** | Failures | Failed to save, connection failed |
| **DEBUG** | Detailed tracing | Every config lookup (only if enabled) |

## Enable Debug Logging

To see detailed debug logs:

1. Open Settings: `Cmd+,` or `Ctrl+,`
2. Search for: `forgejo.debug`
3. Check the box to enable
4. Reload the window
5. Debug logs will now appear in the output

## Log Format

All logs are formatted as:

```
[2026-01-31T04:30:15.123Z] [INFO] Adding instance: {
  "id": "abc-123",
  "name": "Codeberg",
  "url": "https://codeberg.org"
}
```

- **Timestamp**: ISO 8601 format
- **Level**: INFO, WARN, ERROR, or DEBUG
- **Message**: Human-readable description
- **Data**: JSON objects for structured data

## Common Log Messages

### During Onboarding

```
[INFO] Starting onboarding wizard...
[INFO] Attempting to save instance...
[INFO] Adding instance: { id: "...", name: "...", url: "..." }
[INFO] Current instances count: 0
[INFO] Set as default (first instance)
[INFO] Saving instances array with 1 instance(s)
[INFO] Config updated successfully
[INFO] Verification: found 1 instance(s) after save
[INFO] ✓ Instance successfully saved and verified
[INFO] Legacy settings synced
[INFO] Onboarding complete: Codeberg (https://codeberg.org)
```

### During Configuration Loading

```
[DEBUG] Getting configuration...
[INFO] Matched instance: Codeberg (exact match)
[DEBUG] Final configuration: { instanceUrl: "...", owner: "...", repo: "..." }
```

### When Issues Occur

```
[WARN] Found and skipped invalid instance: { ... }
[INFO] Cleaned up 1 invalid instance(s)
[ERROR] Failed to save instance: Instance save verification failed
```

## Debugging Steps

### If Instance Won't Save

1. **Open Output**: Run `Forgejo: Show Output Channel`
2. **Clear logs**: Click the trash icon in the Output panel
3. **Try adding instance**: Run `Forgejo: Add Instance`
4. **Check the logs** for:
   - `✓ Instance successfully saved and verified` ← Success
   - `✗ Instance was NOT saved properly!` ← Failure
   - Any `[ERROR]` messages

### If Nothing Shows Up

1. **Check instance count**:
   ```
   [INFO] Verification: found X instance(s) after save
   ```
   - Should be 1 or more after adding

2. **Check for cleanup**:
   ```
   [INFO] Cleaned up X invalid instance(s)
   ```
   - If you see this, invalid instances were removed

3. **Check configuration loading**:
   ```
   [INFO] No instances configured
   ```
   - Means the save didn't persist

### If PRs/Issues Don't Load

1. **Check instance matching**:
   ```
   [INFO] Matched instance: YourInstance (exact match)
   ```
   - Should see your instance name and match type

2. **Check for errors**:
   ```
   [ERROR] Could not determine owner/repo from git remote
   ```
   - Means git remote isn't set up correctly

## Benefits Over Console.log

| Feature | console.log | Output API |
|---------|-------------|------------|
| Easy access | ❌ Need Developer Tools | ✅ Output panel |
| Persistent | ❌ Clears on reload | ✅ Stays visible |
| Formatted | ❌ Plain text | ✅ Timestamps, levels |
| User-friendly | ❌ Technical | ✅ Built for users |
| Searchable | ❌ Hard to find | ✅ Easy to search |
| Debug mode | ❌ No | ✅ Toggle on/off |

## For Developers

### Using the Logger in Code

```typescript
import { logInfo, logWarn, logError, logDebug } from '../utils/logger';

// Info - normal operations
logInfo('Starting process...');
logInfo('Instance added:', { id: instance.id, name: instance.name });

// Warning - recoverable issues
logWarn('Found invalid instance:', instance);

// Error - failures
logError('Failed to save:', error);

// Debug - only when debug mode enabled
logDebug('Configuration:', config);
```

### Showing Output Programmatically

```typescript
import { showOutput } from '../utils/logger';

// Show the output channel
showOutput();

// Or via command
vscode.commands.executeCommand('forgejo.showOutput');
```

## FAQ

**Q: Do I still need Developer Tools?**
A: No! The Output panel is sufficient for normal debugging. Developer Tools are only needed for deep debugging of VS Code itself.

**Q: Can I save the logs to a file?**
A: Yes! Right-click in the Output panel → "Save as..." or copy and paste.

**Q: How do I clear the logs?**
A: Click the trash can icon in the Output panel.

**Q: Will this slow down the extension?**
A: No, logging is very fast. Debug logs only appear when enabled.

**Q: Can I see old console.log messages?**
A: Errors and warnings still appear in both console and Output for visibility. Info and debug only go to Output.

---

## Quick Reference

| Task | Command |
|------|---------|
| View logs | `Forgejo: Show Output Channel` |
| Enable debug | Settings → `forgejo.debug` → ✓ |
| Clear logs | Click 🗑️ in Output panel |
| Save logs | Right-click → Save as... |
| Run diagnostics | `Forgejo: Show Diagnostics` |

