/*
 * Shared markdown renderer for all Forgejo webviews.
 *
 * Hand-rolled GFM-ish renderer (preserves the implementation that previously
 * lived inside prDetail/index.js — single source of truth now).
 *
 * Exposed on `window.ForgejoMarkdown` so each webview's inline script can call
 * `ForgejoMarkdown.render(text)`. The webview must also include the matching
 * `escapeHtml` helper (see shared/util.js).
 */
(function (global) {
  function sanitizeUrl(url) {
    var t = (url || '').trim().toLowerCase();
    if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('mailto:')) return url.trim();
    return '';
  }

  function processInline(text) {
    if (!text) return '';
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_m, alt, url) {
      var s = sanitizeUrl(url);
      return s ? '<img src="' + s + '" alt="' + alt + '" style="max-width:100%;">' : alt;
    });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, lt, url) {
      var s = sanitizeUrl(url);
      return s ? '<a href="' + s + '">' + lt + '</a>' : lt;
    });
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
    var esc = escapeHtml || global.ForgejoUtil.escapeHtml;
    var html = esc(text);
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_match, lang, code) {
      var langAttr = lang ? ' class="language-' + lang + '"' : '';
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code' + langAttr + '>' + code + '</code></pre>');
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
    var inList = false, listType = '';
    var inBlockquote = false, blockquoteLines = [];
    var inTable = false, tableLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim().match(/^%%CODEBLOCK_\d+%%$/)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        if (inBlockquote) { result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false; }
        if (inTable) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
        result.push(line.trim());
        continue;
      }
      if (inBlockquote && !line.match(/^&gt;\s?/)) {
        result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false;
      }
      if (inTable && !line.match(/^\|/)) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
      if (inList && line.trim() !== '' && !line.match(/^(\s*[-*+]\s|\s*\d+\.\s)/)) {
        result.push('</' + listType + '>'); inList = false; listType = '';
      }
      if (line.match(/^\s*([-*_]\s*){3,}$/)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        result.push('<hr>'); continue;
      }
      var headingMatch = line.match(/^(#{1,6})\s+(.*?)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        result.push('<h' + level + '>' + processInline(headingMatch[2]) + '</h' + level + '>');
        continue;
      }
      if (line.match(/^&gt;\s?/)) { inBlockquote = true; blockquoteLines.push(line.replace(/^&gt;\s?/, '')); continue; }
      if (line.match(/^\|/)) { if (!inTable) { inTable = true; tableLines = []; } tableLines.push(line); continue; }
      var ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') { if (inList) result.push('</' + listType + '>'); result.push('<ul>'); inList = true; listType = 'ul'; }
        var liContent = ulMatch[2];
        var taskMatch = liContent.match(/^\[([ xX])\]\s+(.*)/);
        if (taskMatch) {
          var checked = taskMatch[1] !== ' ' ? ' checked' : '';
          result.push('<li class="task-list-item"><input type="checkbox" class="task-checkbox"' + checked + '> ' + processInline(taskMatch[2]) + '</li>');
        } else {
          result.push('<li>' + processInline(liContent) + '</li>');
        }
        continue;
      }
      var olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (olMatch) {
        if (!inList || listType !== 'ol') { if (inList) result.push('</' + listType + '>'); result.push('<ol>'); inList = true; listType = 'ol'; }
        result.push('<li>' + processInline(olMatch[2]) + '</li>'); continue;
      }
      if (line.trim() === '') continue;
      result.push('<p>' + processInline(line) + '</p>');
    }
    if (inBlockquote) result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>');
    if (inTable) result.push(buildTable(tableLines));
    if (inList) result.push('</' + listType + '>');
    var output = result.join('\n');
    for (var cb = 0; cb < codeBlocks.length; cb++) output = output.replace('%%CODEBLOCK_' + cb + '%%', codeBlocks[cb]);
    for (var ic = 0; ic < inlineCodes.length; ic++) output = output.replace(new RegExp('%%INLINECODE_' + ic + '%%', 'g'), inlineCodes[ic]);
    return output;
  }

  global.ForgejoMarkdown = { render: renderMarkdown, processInline: processInline };
})(typeof window !== 'undefined' ? window : this);
