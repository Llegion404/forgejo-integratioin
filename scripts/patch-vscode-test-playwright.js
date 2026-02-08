#!/usr/bin/env node
/**
 * Patches @mshanemc/vscode-test-playwright to fix missing exports map entry.
 * The package internally does require.resolve("@mshanemc/vscode-test-playwright/dist/injected/index.js")
 * but its package.json exports map doesn't include that subpath.
 * This script adds the missing entry.
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@mshanemc',
  'vscode-test-playwright',
  'package.json'
);

if (!fs.existsSync(pkgPath)) {
  console.log('[patch] @mshanemc/vscode-test-playwright not installed, skipping patch');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.exports && !pkg.exports['./dist/injected/index.js']) {
  pkg.exports['./dist/injected/index.js'] = './dist/injected/index.js';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('[patch] Added missing exports entry for ./dist/injected/index.js');
} else {
  console.log('[patch] Exports entry already present or no exports map, skipping');
}
