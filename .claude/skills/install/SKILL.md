---
name: install
description: Package and install the Forgejo VS Code extension locally. Use when you need to test the extension in VS Code. Triggers on mentions of "install extension", "test extension locally", "package vsix", or "/install".
user-invocable: true
allowed-tools:
  - Bash(npm run compile:*)
  - Bash(vsce package:*)
  - Bash(code --install-extension:*)
  - Bash(ls:*)
  - Bash(bash:.claude/skills/install/scripts/install.sh:*)
---

# Install Extension Skill

Package and install the Forgejo VS Code extension into VS Code for local testing.

## Usage

Invoke this skill when you need to:
- Test extension changes in VS Code
- Package the extension as a .vsix file
- Install the extension locally

## Commands

### Full Install (compile + package + install)

```bash
# 1. Compile TypeScript
npm run compile

# 2. Package as .vsix
vsce package --baseImagesUrl https://example.com

# 3. Install in VS Code (force to overwrite existing)
code --install-extension forgejo-vscode-*.vsix --force
```

## Notes

- The `--force` flag overwrites any existing installation
- The `--baseImagesUrl` flag is needed because the package.json doesn't have a repository field

## Output

After installation, the extension will be available in VS Code's Extensions view under "Forgejo".

## Workflow

1. Make code changes
2. Run `/install` to test changes
3. Reload VS Code window if needed
4. Test the extension functionality