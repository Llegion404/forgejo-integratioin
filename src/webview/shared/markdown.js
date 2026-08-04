/*
 * Shared markdown renderer for all Forgejo webviews.
 *
 * Hand-rolled GFM-ish renderer. XSS-safe by construction:
 *   1. Input is HTML-escaped BEFORE any transformation.
 *   2. All link/image URLs pass through `sanitizeUrl` (http/https/mailto only,
 *      plus relative URLs resolved against the configured instance base).
 *   3. The CSP backstop blocks any residual script injection.
 *
 * Exposed on `window.ForgejoMarkdown`:
 *   ForgejoMarkdown.render(text, escapeHtml?)
 *   ForgejoMarkdown.processInline(text)
 *   ForgejoMarkdown.configure({ instanceUrl })   resolve relative links + mark internal
 *   ForgejoMarkdown.setHighlight(lang, fn)        plug in a syntax highlighter
 *
 * Inline linkifies (added for Forgejo richness): @mentions, owner/repo#N and
 * bare #N issue refs, and bare/angle-bracket autolinks. These are produced
 * AFTER markdown links/images so attribute URLs are placeholder-protected and
 * never double-linkified.
 */
(function (global) {
  var config = { instanceUrl: '' };
  var highlighters = {};

  function configure(options) {
    if (!options) return;
    if (typeof options.instanceUrl === 'string') {
      config.instanceUrl = options.instanceUrl.replace(/\/$/, '');
    }
  }

  function setHighlight(lang, fn) {
    if (lang && typeof fn === 'function') highlighters[String(lang).toLowerCase()] = fn;
    else if (lang && fn === null) delete highlighters[String(lang).toLowerCase()];
  }

  function sanitizeUrl(url) {
    var raw = (url || '').trim();
    var t = raw.toLowerCase();
    if (t.indexOf('http://') === 0 || t.indexOf('https://') === 0 || t.indexOf('mailto:') === 0) return raw;
    // Relative path with a configured instance base → resolve to absolute so it
    // is clickable (marked data-internal so webviews can route it in-extension).
    if (config.instanceUrl && raw.charAt(0) === '/' && raw.charAt(1) !== '/') {
      return config.instanceUrl + raw;
    }
    return '';
  }

  // Marks a resolved URL as internal (same Forgejo instance) for in-extension routing.
  function linkAttrs(url) {
    if (config.instanceUrl && typeof url === 'string' && url.indexOf(config.instanceUrl) === 0) {
      return ' data-internal="true"';
    }
    return '';
  }

  function unescapeHtml(text) {
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function processInline(text) {
    if (!text) return '';
    // 1. images
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_m, alt, url) {
      var s = sanitizeUrl(url);
      return s ? '<img src="' + s + '"' + linkAttrs(s) + ' alt="' + alt + '" style="max-width:100%;">' : alt;
    });
    // 2. links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, lt, url) {
      var s = sanitizeUrl(url);
      return s ? '<a href="' + s + '"' + linkAttrs(s) + '>' + lt + '</a>' : lt;
    });
    // 3. protect href/src attribute values so the linkify passes below cannot
    //    corrupt URLs already inside tags or double-linkify link text.
    var attrs = [];
    text = text.replace(/\b(href|src)="([^"]*)"/g, function (_m, attr, val) {
      var idx = attrs.length;
      attrs.push(attr + '="' + val + '"');
      return '\u0000ATTR' + idx + '\u0000';
    });
    // 4. full issue/PR refs: owner/repo#123
    text = text.replace(/(^|[^\w\/])([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#(\d+)\b/g, function (_m, pre, o, r, n) {
      return pre + '<a class="issue-ref" data-owner="' + o + '" data-repo="' + r + '" data-number="' + n + '">' + o + '/' + r + '#' + n + '</a>';
    });
    // 5. angle-bracket autolinks: <https://...>
    text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, function (_m, url) {
      return '<a href="' + url + '"' + linkAttrs(url) + '>' + url + '</a>';
    });
    // 6. bare-URL autolinks (skip those already inside an attribute or anchor)
    text = text.replace(/(^|[^\w"'=\/\]>])((?:https?:\/\/)[^\s<]+)(?=[\s<]|$)/g, function (_m, pre, url) {
      var trail = '';
      while (url && '.!,;:?)\u0027'.indexOf(url.charAt(url.length - 1)) !== -1) {
        trail = url.charAt(url.length - 1) + trail;
        url = url.slice(0, -1);
      }
      if (!/^https?:\/\//.test(url)) return _m;
      return pre + '<a href="' + url + '"' + linkAttrs(url) + '>' + url + '</a>' + trail;
    });
    // 7. @mentions (the char before @ must be non-word and non-@, so emails are safe)
    text = text.replace(/(^|[^\w@])@([A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}[A-Za-z0-9])?)/g, function (_m, pre, user) {
      return pre + '<a class="mention" data-username="' + user + '">@' + user + '</a>';
    });
    // 8. bare issue/PR refs: #123
    text = text.replace(/(^|[^\w#])#(\d+)\b/g, function (_m, pre, n) {
      return pre + '<a class="issue-ref" data-number="' + n + '">#' + n + '</a>';
    });
    // 9. restore protected attribute values
    for (var i = 0; i < attrs.length; i++) {
      text = text.replace('\u0000ATTR' + i + '\u0000', attrs[i]);
    }
    // 10. emphasis
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return text;
  }

  function parseTableRow(line) {
    return line.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
  }

  function buildTable(lines) {
    if (lines.length < 2) return lines.map(function (l) { return '<p>' + processInline(l) + '</p>'; }).join('\n');
    var headerCells = parseTableRow(lines[0]);
    var alignments = [];
    var isSeparator = lines[1].replace(/\s/g, '').match(/^\|(:?-+:?\|)*:?-+:?\|?$/);
    var bodyStartIndex = 1;
    if (isSeparator) {
      bodyStartIndex = 2;
      var sepCells = parseTableRow(lines[1]);
      for (var a = 0; a < sepCells.length; a++) {
        var cell = sepCells[a].trim();
        if (cell.match(/^:-+:$/)) alignments.push('center');
        else if (cell.match(/^-+:$/)) alignments.push('right');
        else alignments.push('left');
      }
    }
    var html = '<table>\n<thead>\n<tr>';
    for (var h = 0; h < headerCells.length; h++) {
      var align = alignments[h] ? ' style="text-align:' + alignments[h] + '"' : '';
      html += '<th' + align + '>' + processInline(headerCells[h]) + '</th>';
    }
    html += '</tr>\n</thead>\n<tbody>\n';
    for (var r = bodyStartIndex; r < lines.length; r++) {
      var cells = parseTableRow(lines[r]);
      html += '<tr>';
      for (var c = 0; c < cells.length; c++) {
        var a2 = alignments[c] ? ' style="text-align:' + alignments[c] + '"' : '';
        html += '<td' + a2 + '>' + processInline(cells[c]) + '</td>';
      }
      html += '</tr>\n';
    }
    html += '</tbody>\n</table>';
    return html;
  }

  function processBlockquoteContent(lines) {
    return lines.map(function (line) {
      return line.trim() === '' ? '' : '<p>' + processInline(line) + '</p>';
    }).join('\n');
  }

  function renderMarkdown(text, escapeHtml) {
    if (!text) return '';
    var esc = escapeHtml || (global.ForgejoUtil && global.ForgejoUtil.escapeHtml);
    var html = esc ? esc(text) : text;
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_match, lang, code) {
      var langNorm = (lang || '').toLowerCase();
      var idx = codeBlocks.length;
      var body;
      var highlighter = highlighters[langNorm];
      if (highlighter) {
        try { body = highlighter(unescapeHtml(code), langNorm); }
        catch (e) { body = null; }
      }
      if (!body) {
        var langAttr = lang ? ' class="language-' + lang + '"' : '';
        body = '<pre><code' + langAttr + '>' + code + '</code></pre>';
      }
      codeBlocks.push(body);
      return '\n%%CODEBLOCK_' + idx + '%%\n';
    });
    var inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, function (_match, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code>' + code + '</code>');
      return '%%INLINECODE_' + idx + '%%';
    });
    var lines = html.split('\n');
    var result = [];
    var listStack = []; // [{ type: 'ul'|'ol', indent: number }]
    var inBlockquote = false, blockquoteLines = [];
    var inTable = false, tableLines = [];

    function closeAllLists() {
      while (listStack.length) result.push('</' + listStack.pop().type + '>');
    }
    function closeListTo(indent) {
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        result.push('</' + listStack.pop().type + '>');
      }
    }
    function handleListItem(indent, type, content) {
      closeListTo(indent);
      var top = listStack[listStack.length - 1];
      // Open a new list when going deeper, or when switching ul/ol at the same indent.
      if (!top || top.indent < indent || (top.indent === indent && top.type !== type)) {
        if (top && top.indent === indent && top.type !== type) {
          result.push('</' + top.type + '>');
          listStack.pop();
        }
        result.push('<' + type + '>');
        listStack.push({ type: type, indent: indent });
      }
      var taskMatch = content.match(/^\[([ xX])\]\s+(.*)/);
      if (taskMatch) {
        var checked = taskMatch[1] !== ' ' ? ' checked' : '';
        result.push('<li class="task-list-item"><input type="checkbox" class="task-checkbox"' + checked + '> ' + processInline(taskMatch[2]) + '</li>');
      } else {
        result.push('<li>' + processInline(content) + '</li>');
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim().match(/^%%CODEBLOCK_\d+%%$/)) {
        closeAllLists();
        if (inBlockquote) { result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false; }
        if (inTable) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
        result.push(line.trim());
        continue;
      }
      if (inBlockquote && !line.match(/^&gt;\s?/)) {
        result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false;
      }
      if (inTable && !line.match(/^\|/)) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
      if (line.match(/^\s*([-*_]\s*){3,}$/)) {
        closeAllLists();
        result.push('<hr>'); continue;
      }
      var headingMatch = line.match(/^(#{1,6})\s+(.*?)$/);
      if (headingMatch) {
        closeAllLists();
        var level = headingMatch[1].length;
        result.push('<h' + level + '>' + processInline(headingMatch[2]) + '</h' + level + '>');
        continue;
      }
      if (line.match(/^&gt;\s?/)) {
        closeAllLists();
        inBlockquote = true; blockquoteLines.push(line.replace(/^&gt;\s?/, '')); continue;
      }
      if (line.match(/^\|/)) {
        closeAllLists();
        if (!inTable) { inTable = true; tableLines = []; } tableLines.push(line); continue;
      }
      var ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      if (ulMatch) { handleListItem(ulMatch[1].length, 'ul', ulMatch[2]); continue; }
      var olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (olMatch) { handleListItem(olMatch[1].length, 'ol', olMatch[2]); continue; }
      if (line.trim() === '') { continue; }
      closeAllLists();
      result.push('<p>' + processInline(line) + '</p>');
    }
    if (inBlockquote) result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>');
    if (inTable) result.push(buildTable(tableLines));
    closeAllLists();
    var output = result.join('\n');
    for (var cb = 0; cb < codeBlocks.length; cb++) output = output.replace('%%CODEBLOCK_' + cb + '%%', codeBlocks[cb]);
    for (var ic = 0; ic < inlineCodes.length; ic++) output = output.replace(new RegExp('%%INLINECODE_' + ic + '%%', 'g'), inlineCodes[ic]);
    return output;
  }

  global.ForgejoMarkdown = {
    render: renderMarkdown,
    processInline: processInline,
    configure: configure,
    setHighlight: setHighlight
  };
})(typeof window !== 'undefined' ? window : this);
