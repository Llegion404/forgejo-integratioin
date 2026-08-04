/*
 * Unit tests for the shared webview runtime layer (util.js, markdown.js,
 * reactions.js, theme.js). These modules are browser IIFEs that attach to
 * `window`; we stub the minimal DOM globals so they load under jest's node
 * environment and exercise them directly.
 */

// --- Minimal DOM shim ------------------------------------------------------
const fakeWindow: any = {};
(global as any).window = fakeWindow;

function makeElement(): any {
  const el: any = {};
  Object.defineProperty(el, 'textContent', {
    get() { return el._t; },
    set(v: string) {
      el._t = v === null || v === undefined ? '' : String(v);
      el._html = el._t.replace(/[&<>"']/g, (c: string) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]
      );
    },
    configurable: true,
  });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, configurable: true });
  // classList shim (only what theme.js needs)
  const classes = new Set<string>();
  el.classList = {
    add(c: string) { classes.add(c); },
    remove(...cs: string[]) { cs.forEach((c) => classes.delete(c)); },
    contains(c: string) { return classes.has(c); },
    toString() { return Array.from(classes).join(' '); },
  };
  Object.defineProperty(el, 'className', {
    get() { return el.classList.toString(); },
    set(v: string) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach((c: string) => classes.add(c)); },
    configurable: true,
  });
  return el;
}

const fakeBody = makeElement();
(global as any).document = {
  createElement: () => makeElement(),
  body: fakeBody,
};

// Load the modules (they attach their globals to fakeWindow).
require('../../webview/shared/util.js');
require('../../webview/shared/markdown.js');
require('../../webview/shared/reactions.js');
require('../../webview/shared/theme.js');

const ForgejoUtil = fakeWindow.ForgejoUtil;
const ForgejoMarkdown = fakeWindow.ForgejoMarkdown;
const ForgejoReactions = fakeWindow.ForgejoReactions;
const ForgejoTheme = fakeWindow.ForgejoTheme;

// ---------------------------------------------------------------------------
describe('ForgejoUtil', () => {
  describe('escapeHtml', () => {
    it('escapes the five significant characters', () => {
      expect(ForgejoUtil.escapeHtml('<a href="x"> & \'b\'</a>')).toBe(
        '&lt;a href=&quot;x&quot;&gt; &amp; &#39;b&#39;&lt;/a&gt;'
      );
    });
    it('returns empty for null/undefined', () => {
      expect(ForgejoUtil.escapeHtml(null)).toBe('');
      expect(ForgejoUtil.escapeHtml(undefined)).toBe('');
    });
  });

  describe('getContrastColor', () => {
    it('picks white for dark backgrounds', () => {
      expect(ForgejoUtil.getContrastColor('000000')).toBe('#ffffff');
    });
    it('picks black for light backgrounds', () => {
      expect(ForgejoUtil.getContrastColor('ffffff')).toBe('#000000');
    });
    it('expands 3-digit hex', () => {
      expect(ForgejoUtil.getContrastColor('fff')).toBe('#000000');
      expect(ForgejoUtil.getContrastColor('000')).toBe('#ffffff');
    });
  });

  describe('formatTimeAgo', () => {
    it('returns "just now" for < 60s', () => {
      const d = new Date(Date.now() - 10_000).toISOString();
      expect(ForgejoUtil.formatTimeAgo(d)).toBe('just now');
    });
    it('returns minutes', () => {
      const d = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(ForgejoUtil.formatTimeAgo(d)).toBe('5m ago');
    });
    it('returns empty for falsy', () => {
      expect(ForgejoUtil.formatTimeAgo('')).toBe('');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds only under a minute', () => {
      const start = new Date(Date.now() - 45_000).toISOString();
      expect(ForgejoUtil.formatDuration(start)).toBe('45s');
    });
    it('formats minutes + seconds', () => {
      const start = new Date(Date.now() - 125_000).toISOString();
      expect(ForgejoUtil.formatDuration(start)).toBe('2m 5s');
    });
    it('formats hours + minutes', () => {
      const start = new Date(Date.now() - 3905_000).toISOString();
      expect(ForgejoUtil.formatDuration(start)).toBe('1h 5m');
    });
    it('honours an explicit end date', () => {
      expect(ForgejoUtil.formatDuration('2020-01-01T00:00:00Z', '2020-01-01T00:01:30Z')).toBe('1m 30s');
    });
  });

  describe('fileStatusGlyph', () => {
    it('maps each status to its canonical letter', () => {
      expect(ForgejoUtil.fileStatusGlyph('added')).toBe('A');
      expect(ForgejoUtil.fileStatusGlyph('created')).toBe('A');
      expect(ForgejoUtil.fileStatusGlyph('modified')).toBe('M');
      expect(ForgejoUtil.fileStatusGlyph('changed')).toBe('M');
      expect(ForgejoUtil.fileStatusGlyph('removed')).toBe('D');
      expect(ForgejoUtil.fileStatusGlyph('deleted')).toBe('D');
      expect(ForgejoUtil.fileStatusGlyph('renamed')).toBe('R');
      expect(ForgejoUtil.fileStatusGlyph('copied')).toBe('C');
    });
    it('defaults to M and is case-insensitive', () => {
      expect(ForgejoUtil.fileStatusGlyph('MODIFIED')).toBe('M');
      expect(ForgejoUtil.fileStatusGlyph('unknown')).toBe('M');
      expect(ForgejoUtil.fileStatusGlyph('')).toBe('M');
    });
  });

  describe('formatBytes', () => {
    it('formats zero and small values', () => {
      expect(ForgejoUtil.formatBytes(0)).toBe('0 B');
      expect(ForgejoUtil.formatBytes(512)).toBe('512 B');
    });
    it('formats KB/MB/GB', () => {
      expect(ForgejoUtil.formatBytes(1024)).toBe('1.0 KB');
      expect(ForgejoUtil.formatBytes(1048576)).toBe('1.0 MB');
      expect(ForgejoUtil.formatBytes(1073741824)).toBe('1.0 GB');
    });
  });

  describe('icon', () => {
    it('renders a codicon span', () => {
      expect(ForgejoUtil.icon('check')).toBe('<span class="codicon codicon-check" aria-hidden="true"></span>');
    });
    it('appends an extra class', () => {
      expect(ForgejoUtil.icon('sync', 'codicon-modifier-spin')).toContain('codicon-modifier-spin');
    });
  });
});

// ---------------------------------------------------------------------------
describe('ForgejoMarkdown', () => {
  afterEach(() => {
    // reset config + highlighters between tests
    ForgejoMarkdown.configure({ instanceUrl: '' });
    ForgejoMarkdown.setHighlight('js', null as any);
  });

  it('returns empty for falsy input', () => {
    expect(ForgejoMarkdown.render('')).toBe('');
  });

  it('escapes raw HTML', () => {
    const out = ForgejoMarkdown.render('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('renders headings', () => {
    expect(ForgejoMarkdown.render('## Title')).toContain('<h2>Title</h2>');
  });

  it('renders bold/italic/strikethrough', () => {
    expect(ForgejoMarkdown.render('**b**')).toContain('<strong>b</strong>');
    expect(ForgejoMarkdown.render('*i*')).toContain('<em>i</em>');
    expect(ForgejoMarkdown.render('~~s~~')).toContain('<del>s</del>');
  });

  it('renders fenced code blocks with a language class', () => {
    const out = ForgejoMarkdown.render('```js\nvar x = 1\n```');
    expect(out).toContain('class="language-js"');
    expect(out).toContain('<pre>');
  });

  it('renders inline code', () => {
    expect(ForgejoMarkdown.render('use `foo` here')).toContain('<code>foo</code>');
  });

  it('renders ordered and unordered lists', () => {
    expect(ForgejoMarkdown.render('- a\n- b')).toContain('<ul>');
    expect(ForgejoMarkdown.render('1. a\n2. b')).toContain('<ol>');
  });

  it('renders nested lists (not flattened)', () => {
    const out = ForgejoMarkdown.render('- top\n  - sub');
    const ulCount = (out.match(/<ul>/g) || []).length;
    expect(ulCount).toBe(2);
    expect(out).toContain('<li>sub</li>');
  });

  it('renders task-list checkboxes', () => {
    const out = ForgejoMarkdown.render('- [x] done\n- [ ] todo');
    expect(out).toContain('task-list-item');
    expect(out).toContain('checked');
  });

  it('renders tables with alignment', () => {
    const out = ForgejoMarkdown.render('| a | b |\n|:--|:-:|\n| 1 | 2 |');
    expect(out).toContain('<table>');
    expect(out).toContain('text-align:center');
  });

  it('renders blockquotes', () => {
    expect(ForgejoMarkdown.render('> quoted')).toContain('<blockquote>');
  });

  it('renders links and images', () => {
    expect(ForgejoMarkdown.render('[t](https://x.io)')).toContain('<a href="https://x.io">t</a>');
    expect(ForgejoMarkdown.render('![a](https://x.io/i.png)')).toContain('<img src="https://x.io/i.png"');
  });

  it('renders a horizontal rule', () => {
    expect(ForgejoMarkdown.render('---')).toContain('<hr>');
  });

  // --- New linkify features ---
  describe('@mentions', () => {
    it('linkifies a mention', () => {
      const out = ForgejoMarkdown.render('cc @alice please');
      expect(out).toContain('data-username="alice"');
      expect(out).toContain('>@alice<');
    });
    it('does not linkify emails', () => {
      const out = ForgejoMarkdown.render('mail user@example.com');
      expect(out).not.toContain('data-username');
    });
  });

  describe('issue/PR refs', () => {
    it('linkifies a bare #ref', () => {
      const out = ForgejoMarkdown.render('fixes #42');
      expect(out).toContain('class="issue-ref"');
      expect(out).toContain('data-number="42"');
    });
    it('linkifies a full owner/repo#N ref', () => {
      const out = ForgejoMarkdown.render('see forgejo/runner#7');
      expect(out).toContain('data-owner="forgejo"');
      expect(out).toContain('data-repo="runner"');
      expect(out).toContain('data-number="7"');
    });
  });

  describe('autolinks', () => {
    it('linkifies a bare URL', () => {
      const out = ForgejoMarkdown.render('see https://example.com here');
      expect(out).toContain('<a href="https://example.com"');
    });
    it('strips trailing punctuation from a bare URL', () => {
      const out = ForgejoMarkdown.render('visit https://example.com.');
      expect(out).toContain('<a href="https://example.com">https://example.com</a>.');
    });
    it('linkifies an angle-bracket autolink', () => {
      const out = ForgejoMarkdown.render('<https://example.com>');
      expect(out).toContain('<a href="https://example.com"');
    });
  });

  describe('URL sanitisation', () => {
    it('drops javascript: URLs', () => {
      const out = ForgejoMarkdown.render('[x](javascript:alert(1))');
      expect(out).not.toContain('javascript:');
      expect(out).not.toContain('<a');
    });
    it('drops data: URLs', () => {
      const out = ForgejoMarkdown.render('[x](data:text/html,<script>)');
      expect(out).not.toContain('data:');
    });
  });

  describe('configure({ instanceUrl })', () => {
    it('resolves relative URLs against the instance base and marks them internal', () => {
      ForgejoMarkdown.configure({ instanceUrl: 'https://codeberg.org' });
      const out = ForgejoMarkdown.render('[issue](/owner/repo/issues/5)');
      expect(out).toContain('href="https://codeberg.org/owner/repo/issues/5"');
      expect(out).toContain('data-internal="true"');
    });
    it('does not mark external URLs as internal', () => {
      ForgejoMarkdown.configure({ instanceUrl: 'https://codeberg.org' });
      const out = ForgejoMarkdown.render('[x](https://other.io)');
      expect(out).not.toContain('data-internal');
    });
  });

  describe('setHighlight', () => {
    it('invokes the registered highlighter for a code block', () => {
      ForgejoMarkdown.setHighlight('js', (code: string) => '<pre class="hljs"><code>' + code + '</code></pre>');
      const out = ForgejoMarkdown.render('```js\nvar x\n```');
      expect(out).toContain('class="hljs"');
      expect(out).not.toContain('class="language-js"');
    });
    it('falls back to escaped code when the highlighter throws', () => {
      ForgejoMarkdown.setHighlight('py', () => { throw new Error('boom'); });
      const out = ForgejoMarkdown.render('```py\nprint(1)\n```');
      expect(out).toContain('class="language-py"');
    });
  });
});

// ---------------------------------------------------------------------------
describe('ForgejoReactions', () => {
  it('returns empty for no reactions', () => {
    expect(ForgejoReactions.render([])).toBe('');
    expect(ForgejoReactions.render(undefined as any)).toBe('');
  });

  it('aggregates counts per reaction', () => {
    const out = ForgejoReactions.render([
      { reaction: '+1', user: { login: 'a' } },
      { reaction: '+1', user: { login: 'b' } },
      { reaction: 'heart', user: { login: 'a' } },
    ]);
    expect(out).toContain('>👍 2<');
    expect(out).toContain('>❤️ 1<');
  });

  it('marks reactions the current user made with reacted-by-me', () => {
    const out = ForgejoReactions.render(
      [{ reaction: '+1', user: { login: 'alice' } }, { reaction: '-1', user: { login: 'bob' } }],
      { currentUser: 'alice' }
    );
    expect(out).toContain('reaction-pill reacted-by-me" data-reaction="+1"');
    expect(out).not.toContain('reacted-by-me" data-reaction="-1"');
  });

  it('emits the add-reaction button', () => {
    const out = ForgejoReactions.render([{ reaction: '+1', user: { login: 'a' } }]);
    expect(out).toContain('add-reaction-btn');
  });

  it('accepts a function as the second arg (back-compat escapeHtml override)', () => {
    const esc = (t: string) => t.toUpperCase();
    const out = ForgejoReactions.render([{ reaction: 'heart', user: { login: 'a' } }], esc as any);
    // title should be upper-cased by the supplied escaper
    expect(out).toContain('title="A"');
  });

  it('exposes the emoji map', () => {
    expect(ForgejoReactions.emojiMap['+1']).toBeDefined();
    expect(ForgejoReactions.emojiMap['heart']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe('ForgejoTheme', () => {
  beforeEach(() => {
    fakeBody.className = '';
  });

  it('applies the vscode-light class', () => {
    ForgejoTheme.apply('light');
    expect(fakeBody.classList.contains('vscode-light')).toBe(true);
    expect(fakeBody.classList.contains('vscode-dark')).toBe(false);
  });

  it('applies the vscode-high-contrast class', () => {
    ForgejoTheme.apply('high-contrast');
    expect(fakeBody.classList.contains('vscode-high-contrast')).toBe(true);
  });

  it('defaults to dark and clears other theme classes', () => {
    ForgejoTheme.apply('light');
    ForgejoTheme.apply('dark');
    expect(fakeBody.classList.contains('vscode-light')).toBe(false);
    expect(fakeBody.classList.contains('vscode-dark')).toBe(true);
  });
});
