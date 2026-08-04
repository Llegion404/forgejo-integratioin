/*
 * Reactions rendering helper for all Forgejo webviews.
 *
 * Usage from inline script:
 *   window.ForgejoReactions.render(reactionsArray, { currentUser: 'alice' });
 *   window.ForgejoReactions.emojiMap['+1'];  // → '\u{1F44D}'
 *
 * Returns an HTML string of reaction pills with data-reaction attributes. A
 * pill whose reaction list contains the current user gets `reacted-by-me` so
 * the click handler can toggle add/remove. The webview wires the toggle.
 *
 * Back-compat: `render(reactions, fn)` where fn is a Function is treated as
 * the escapeHtml override.
 */
(function (global) {
  var emojiMap = {
    '+1': '\u{1F44D}',
    '-1': '\u{1F44E}',
    'laugh': '\u{1F604}',
    'hooray': '\u{1F389}',
    'confused': '\u{1F615}',
    'heart': '\u2764\uFE0F',
    'rocket': '\u{1F680}',
    'eyes': '\u{1F440}'
  };

  function render(reactions, options) {
    if (!reactions || reactions.length === 0) return '';
    var opts = typeof options === 'function' ? { escapeHtml: options } : (options || {});
    var esc = opts.escapeHtml || (global.ForgejoUtil && global.ForgejoUtil.escapeHtml) || function (t) { return t; };
    var currentUser = opts.currentUser || '';
    var counts = {};
    var users = {};
    var mine = {};
    reactions.forEach(function (r) {
      counts[r.reaction] = (counts[r.reaction] || 0) + 1;
      if (!users[r.reaction]) users[r.reaction] = [];
      if (r.user && r.user.login) {
        users[r.reaction].push(r.user.login);
        if (currentUser && r.user.login === currentUser) mine[r.reaction] = true;
      }
    });
    var html = '<div class="reactions-bar">';
    Object.keys(counts).sort().forEach(function (r) {
      var emoji = emojiMap[r] || r;
      var cls = 'reaction-pill' + (mine[r] ? ' reacted-by-me' : '');
      html += '<span class="' + cls + '" data-reaction="' + esc(r) + '" title="' + esc(users[r].join(', ')) + '">' + emoji + ' ' + counts[r] + '</span>';
    });
    html += '<span class="add-reaction-btn" title="Add reaction">+</span></div>';
    return html;
  }

  global.ForgejoReactions = { render: render, emojiMap: emojiMap };
})(typeof window !== 'undefined' ? window : this);
