---
name: sync-forgejo
description: Bidirectionally sync issues between the local beads issue tracker and the Forgejo instance. Imports new Forgejo issues into beads, exports beads-only issues to Forgejo, and syncs status changes. Triggers on "/sync-forgejo" or mentions of "sync issues", "sync forgejo issues", "import forgejo issues", "export issues to forgejo".
user-invocable: true
allowed-tools:
  - Bash(node:.claude/skills/sync-forgejo/scripts/dist/sync-forgejo.js:*)
  - Bash(bd:*)
---

# Sync Forgejo Issues Skill

Bidirectionally sync issues between the local beads issue tracker and the Forgejo instance detected from the git remote.

## Usage

```
/sync-forgejo                  # Dry run (default) - show what would change
/sync-forgejo --execute        # Apply changes
/sync-forgejo --migrate-refs   # One-time: set external-ref from notes field
```

## Modes

### Dry Run (default)
Shows a summary of what would be synced without making any changes. Always run this first to review planned actions.

### Execute (`--execute`)
Applies all sync actions:
- **Import**: Creates beads issues for Forgejo-only issues (with `external-ref` and notes link)
- **Export**: Creates Forgejo issues for beads-only issues (sets `external-ref` after creation)
- **Status sync**: Syncs open/closed status using "most recently updated wins" (Forgejo wins ties)

### Migrate Refs (`--migrate-refs`)
One-time migration for existing issues that were manually imported with Forgejo URLs in the `notes` field. Sets the `external-ref` field (e.g., `forgejo-25`) based on the issue number parsed from the notes URL.

## Requirements

- **FORGEJO_TOKEN** environment variable or `~/.config/forgejo-claude/config.json`: Required for creating/updating Forgejo issues (export). Optional for import-only from public repos.
- **Git remote**: The script auto-detects the Forgejo instance from `git remote get-url origin`.
- **bd CLI**: Must be available in PATH.
- **Node.js 18+**: Bundled single file, no runtime dependencies.

## How It Works

1. Detects Forgejo host/owner/repo from the git remote URL
2. Fetches all Forgejo issues via the API (filters out PRs)
3. Exports all beads issues via `bd export`
4. Links issues using `external-ref` field (format: `forgejo-{N}`)
5. Classifies each issue as MATCHED, FORGEJO_ONLY, or BEADS_ONLY
6. For matched pairs, compares status and uses timestamps to determine sync direction
7. Reports planned actions, then executes if `--execute` is set
