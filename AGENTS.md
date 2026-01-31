# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

Use 'bd' for task tracking


## Starting Work (Always Create Worktree)

**Before writing any code**, ask the user:
> "Would you like me to create a new worktree for this work? If yes, what branch name should I use?"

**Worktree Location:** `.worktrees/<branch-name>/`

**Command sequence:**
```bash
# Ask user for branch name based on feature
# Example: user says "feature-auth-fix"
mkdir -p .worktrees
git worktree add .worktrees/feature-auth-fix -b feature-auth-fix
cd .worktrees/feature-auth-fix
```

Why worktrees?

Keep master/main clean and stable
Parallel work on multiple features
Easy context switching without stashing
Isolated environments per feature
After creating worktree:

Switch to the worktree directory
Check out/claim the issue with bd update <id> --status in_progress
Begin coding in the worktree

