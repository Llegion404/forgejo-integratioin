#!/usr/bin/env bash
set -euo pipefail

VERSION=$(jq -r .version package.json)
VSIX="forgejo-vscode-${VERSION}.vsix"
PROFILE_EXT="$(ls ~/.config/Code/User/profiles/*/extensions.json 2>/dev/null | head -1)"

if [ -z "$PROFILE_EXT" ]; then
  PROFILE_EXT="$HOME/.config/Code/User/extensions.json"
fi

echo "==> Compiling..."
npm run compile

echo "==> Packaging ${VSIX}..."
npx vsce package --allow-missing-repository \
  --baseContentUrl https://codeberg.org/maxking/forgejo-vscode/raw/branch/master \
  --baseImagesUrl https://codeberg.org/maxking/forgejo-vscode/raw/branch/master

echo "==> Installing..."
code --install-extension "$VSIX" --force

echo "==> Adding to VS Code profile..."
python3 -c "
import json, os, time

profile_path = '${PROFILE_EXT}'
with open(profile_path) as f:
    data = json.load(f)

ids = [e['identifier']['id'] for e in data]
if 'maxking.forgejo-vscode' not in ids:
    ext_dir = os.path.expanduser('~/.vscode/extensions/maxking.forgejo-vscode-${VERSION}')
    data.append({
        'identifier': {'id': 'maxking.forgejo-vscode'},
        'version': '${VERSION}',
        'location': {
            '\$mid': 1,
            'fsPath': ext_dir,
            'external': 'file://' + ext_dir,
            'path': ext_dir,
            'scheme': 'file'
        },
        'relativeLocation': 'maxking.forgejo-vscode-${VERSION}',
        'metadata': {
            'installedTimestamp': int(time.time() * 1000),
            'pinned': True,
            'source': 'vsix'
        }
    })
    with open(profile_path, 'w') as f:
        json.dump(data, f, indent=2)
    print('Added to profile: ' + profile_path)
else:
    print('Already in profile: ' + profile_path)
"

echo ""
echo "==> Done! Reload VS Code: Ctrl+Shift+P -> Developer: Reload Window"
