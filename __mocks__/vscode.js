// Mock implementation of VS Code API for Jest unit tests

class EventEmitter {
  constructor() {
    this.listeners = [];
  }

  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index !== -1) {
            this.listeners.splice(index, 1);
          }
        }
      };
    };
  }

  fire(data) {
    this.listeners.forEach(listener => listener(data));
  }

  dispose() {
    this.listeners = [];
  }
}

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  static parse(uri) {
    const match = uri.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i) ||
                  uri.match(/^([a-z][a-z0-9+.-]*):([^?#]*)(\?[^#]*)?(#.*)?$/i);

    if (!match) {
      throw new Error('Invalid URI');
    }

    if (match[0].includes('://')) {
      // URI with authority (e.g., http://example.com/path)
      return new Uri(match[1], match[2], match[3] || '', match[4] || '', match[5] || '');
    } else {
      // URI without authority (e.g., forgejo-pr:/path)
      return new Uri(match[1], '', match[2] || '', match[3] || '', match[4] || '');
    }
  }

  static file(path) {
    return new Uri('file', '', path, '', '');
  }

  with(change) {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment
    );
  }

  toString() {
    let result = `${this.scheme}:`;
    if (this.authority) {
      result += `//${this.authority}`;
    }
    result += this.path;
    if (this.query) {
      result += this.query;
    }
    if (this.fragment) {
      result += this.fragment;
    }
    return result;
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
    this.contextValue = undefined;
    this.command = undefined;
    this.iconPath = undefined;
    this.tooltip = undefined;
    this.description = undefined;
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
};

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showInputBox: jest.fn(),
  createTreeView: jest.fn()
};

const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    update: jest.fn(),
    has: jest.fn()
  })),
  workspaceFolders: undefined
};

const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

module.exports = {
  EventEmitter,
  Uri,
  TreeItem,
  TreeItemCollapsibleState,
  ConfigurationTarget,
  ThemeIcon,
  ThemeColor,
  window,
  workspace,
  commands
};
