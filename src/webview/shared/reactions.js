/*
 * Reactions rendering helper for all Forgejo webviews.
 *
 * Usage from inline script:
 *   window.ForgejoReactions.render(reactionsArray);
 *   window.ForgejoReactions.emojiMap['+1'];  // → '\u{1F44D}'
 *
 * Returns an HTML string of reaction pills with data-reaction attributes.
 * The webview's click handler is responsible for toggling.
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

  function render(reactions, escapeHtml) {
    if (!reactions || reactions.length === 0) return '';
    var esc = escapeHtml || (global.ForgejoUtil && global.ForgejoUtil.escapeHtml) || function (t) { return t; };
    var counts = {};
    var users = {};
    reactions.forEach(function (r) {
      counts[r.reaction] = (counts[r.reaction] || 0) + 1;
      if (!users[r.reaction]) users[r.reaction] = [];
      if (r.user && r.user.login) users[r.reaction].push(r.user.login);
    });
    var html = '<div class="reactions-bar">';
    Object.keys(counts).sort().forEach(function (r) {
      var emoji = emojiMap[r] || r;
      html += '<span class="reaction-pill" data-reaction="' + esc(r) + '" title="' + esc(users[r].join(', ')) + '">' + emoji + ' ' + counts[r] + '</span>';
    });
    html += '<span class="add-reaction-btn" title="Add reaction">+</span></div>';
    return html;
  }

  global.ForgejoReactions = { render: render, emojiMap: emojiMap };
})(typeof window !== 'undefined' ? window : this);
