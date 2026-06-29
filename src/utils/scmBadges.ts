import * as vscode from 'vscode';

const COLORS: Record<string, { light: string; dark: string }> = {
  added:    { light: '#388a34', dark: '#73c991' },
  modified: { light: '#895503', dark: '#cca700' },
  removed:  { light: '#a1260d', dark: '#f14c4c' },
  renamed:  { light: '#0070c0', dark: '#3a8fd4' },
};

const LETTERS: Record<string, string> = {
  added:    'A',
  modified: 'M',
  changed:  'M',
  removed:  'D',
  renamed:  'R',
};

function svgUri(letter: string, color: string): vscode.Uri {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">',
    `<text x="8" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="${color}"`,
    ' font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', monospace">',
    letter,
    '</text>',
    '</svg>'
  ].join('');
  return vscode.Uri.parse(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

export function createScmBadge(status: string): { light: vscode.Uri; dark: vscode.Uri } | vscode.ThemeIcon {
  const colorKey = status === 'changed' ? 'modified' : status;
  const colors = COLORS[colorKey];
  const letter = LETTERS[status];

  if (!colors || !letter) {
    return new vscode.ThemeIcon('file');
  }

  return {
    light: svgUri(letter, colors.light),
    dark: svgUri(letter, colors.dark),
  };
}
