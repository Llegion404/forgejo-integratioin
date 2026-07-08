# Agent Instructions

**Codebase Index:** Read `CODEBASE_INDEX.md` first for a complete file-by-file map, architectural overview, and cross-file data flows.

## Building and Installing Extension

**ALWAYS build the extension after making changes** to verify it compiles correctly.

**Build command:**
```bash
npm run compile
```

**Package for distribution:**
```bash
vsce package --allow-missing-repository
```

**After building, ALWAYS ask the user:**
> "Would you like me to install the extension in VS Code?"

**Install command (run only if user says yes):**
```bash
code --install-extension forgejo-vscode-0.1.0.vsix --force --user-data-dir ~/.config/Code/Profile/paradox
```

**Why?**
- Building catches TypeScript errors before committing
- Installing allows immediate testing of changes
- The `--force` flag ensures the extension is updated even if same version
