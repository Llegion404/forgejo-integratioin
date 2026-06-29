(function() {
  var vscode = acquireVsCodeApi();
  var currentTheme = 'dark';
  var viewData = null;

  var STATUS_LETTERS = { added: 'A', modified: 'M', changed: 'M', removed: 'D', renamed: 'R' };

  window.addEventListener('message', function(event) {
    var msg = event.data;
    switch (msg.type) {
      case 'update':
        viewData = msg.data;
        render(msg.data);
        break;
      case 'loading':
        document.getElementById('loading').style.display = msg.show ? 'block' : 'none';
        break;
      case 'error':
        showError(msg.message);
        break;
      case 'theme':
        currentTheme = msg.theme;
        document.body.setAttribute('data-theme', msg.theme);
        break;
      case 'actionComplete':
        handleActionComplete(msg.action, msg.success);
        break;
    }
  });

  function showError(message) {
    document.getElementById('loading').style.display = 'none';
    var errorEl = document.getElementById('error');
    errorEl.style.display = 'block';
    document.getElementById('error-message').textContent = message;
    document.getElementById('retry-btn').onclick = function() {
      vscode.postMessage({ type: 'refresh' });
    };
  }

  function handleActionComplete(action, success) {
    if (action === 'addComment') {
      var submitBtn = document.getElementById('submit-comment-btn');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
      if (success) {
        document.getElementById('comment-input').value = '';
        document.getElementById('comment-input-container').style.display = 'none';
      }
    }
    if (action === 'addReview') {
      var submitBtn = document.getElementById('submit-review-btn');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Review';
      if (success) {
        document.getElementById('review-body').value = '';
        document.getElementById('review-dialog').style.display = 'none';
      }
    }
  }

  function setupCommentUI() {
    var addCommentBtn = document.getElementById('add-comment-btn');
    var commentInputContainer = document.getElementById('comment-input-container');
    var commentInput = document.getElementById('comment-input');
    var submitCommentBtn = document.getElementById('submit-comment-btn');
    var cancelCommentBtn = document.getElementById('cancel-comment-btn');

    addCommentBtn.addEventListener('click', function() {
      commentInputContainer.style.display = 'block';
      commentInput.focus();
    });

    cancelCommentBtn.addEventListener('click', function() {
      commentInputContainer.style.display = 'none';
      commentInput.value = '';
    });

    submitCommentBtn.addEventListener('click', function() {
      var body = commentInput.value.trim();
      if (!body) return;
      submitCommentBtn.disabled = true;
      submitCommentBtn.textContent = 'Submitting...';
      vscode.postMessage({ type: 'addComment', body: body });
    });

    commentInput.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitCommentBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelCommentBtn.click();
      }
    });

    var addReviewBtn = document.getElementById('add-review-btn');
    var reviewDialog = document.getElementById('review-dialog');
    var reviewBody = document.getElementById('review-body');
    var reviewState = document.getElementById('review-state');
    var submitReviewBtn = document.getElementById('submit-review-btn');
    var cancelReviewBtn = document.getElementById('cancel-review-btn');

    addReviewBtn.addEventListener('click', function() {
      reviewDialog.style.display = 'block';
      reviewBody.focus();
    });

    cancelReviewBtn.addEventListener('click', function() {
      reviewDialog.style.display = 'none';
      reviewBody.value = '';
    });

    submitReviewBtn.addEventListener('click', function() {
      var body = reviewBody.value.trim();
      if (!body) return;
      submitReviewBtn.disabled = true;
      submitReviewBtn.textContent = 'Submitting...';
      vscode.postMessage({ type: 'addReview', state: reviewState.value, body: body });
    });

    reviewBody.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelReviewBtn.click();
      }
    });
  }

  function render(data) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    var content = document.getElementById('content');
    content.style.display = 'block';

    var totalAdds = 0, totalDels = 0;
    data.files.forEach(function(f) {
      totalAdds += f.additions || 0;
      totalDels += f.deletions || 0;
    });

    document.getElementById('review-title').textContent = 'PR #' + data.pr.number + ': ' + data.pr.title;
    var summary = document.getElementById('review-summary');
    summary.innerHTML = data.files.length + ' file' + (data.files.length !== 1 ? 's' : '') + ' changed'
      + ' · ' + '<span class="stat-added">+' + totalAdds + '</span>'
      + ' <span class="stat-deleted">-' + totalDels + '</span>';

    document.getElementById('refresh-btn').onclick = function() {
      vscode.postMessage({ type: 'refresh' });
    };

    var fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    if (data.files.length === 0) {
      fileList.innerHTML = '<div class="diff-empty">No files changed</div>';
      return;
    }

    data.files.forEach(function(file, idx) {
      var fileItem = document.createElement('div');
      fileItem.className = 'file-item';

      var statusClass = 'status-' + (file.status === 'changed' ? 'modified' : file.status);
      var statusLetter = STATUS_LETTERS[file.status] || '?';

      var fileHeader = document.createElement('div');
      fileHeader.className = 'file-header';

      var chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '\u25B6';

      var badge = document.createElement('span');
      badge.className = 'status-badge ' + statusClass;
      badge.textContent = statusLetter;

      var nameEl = document.createElement('span');
      nameEl.className = 'filename';
      nameEl.title = file.filename;
      nameEl.textContent = file.filename;

      var stats = document.createElement('span');
      stats.className = 'file-stats';
      if (file.additions > 0) {
        var addSpan = document.createElement('span');
        addSpan.className = 'added';
        addSpan.textContent = '+' + file.additions;
        stats.appendChild(addSpan);
      }
      if (file.additions > 0 && file.deletions > 0) {
        stats.appendChild(document.createTextNode(' '));
      }
      if (file.deletions > 0) {
        var delSpan = document.createElement('span');
        delSpan.className = 'deleted';
        delSpan.textContent = '-' + file.deletions;
        stats.appendChild(delSpan);
      }

      var viewToggle = document.createElement('span');
      viewToggle.className = 'view-toggle';
      viewToggle.textContent = 'View';
      viewToggle.title = 'Open in diff editor';
      viewToggle.onclick = function(e) {
        e.stopPropagation();
        vscode.postMessage({
          type: 'openFile',
          filename: file.filename,
          owner: data.owner,
          repo: data.repo,
          baseRef: data.baseRef,
          headRef: data.headRef
        });
      };

      fileHeader.appendChild(chevron);
      fileHeader.appendChild(badge);
      fileHeader.appendChild(nameEl);
      fileHeader.appendChild(stats);
      fileHeader.appendChild(viewToggle);

      var fileDiff = document.createElement('div');
      fileDiff.className = 'file-diff';

      if (file.patch) {
        fileDiff.appendChild(renderDiff(file.patch));
      } else {
        var noPatch = document.createElement('div');
        noPatch.className = 'diff-no-patch';
        noPatch.textContent = file.status === 'removed' ? 'File deleted' :
          'Binary file not shown';
        fileDiff.appendChild(noPatch);
      }

      var expanded = false;

      fileHeader.onclick = function() {
        expanded = !expanded;
        if (expanded) {
          fileItem.classList.add('expanded');
          fileHeader.classList.add('expanded');
        } else {
          fileItem.classList.remove('expanded');
          fileHeader.classList.remove('expanded');
        }
      };

      fileItem.appendChild(fileHeader);
      fileItem.appendChild(fileDiff);
      fileList.appendChild(fileItem);
    });
  }

  function renderDiff(patch) {
    var container = document.createElement('div');
    container.className = 'diff-view';

    var lines = patch.split('\n');

    var currentHunk = null;
    var oldLine = 0, newLine = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (line === '' && i === lines.length - 1) continue;

      var hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);

        if (currentHunk && currentHunk.children.length === 0) {
          currentHunk.remove();
        }

        currentHunk = document.createElement('div');
        currentHunk.className = 'diff-hunk';

        var hdr = document.createElement('div');
        hdr.className = 'diff-hunk-header';
        hdr.textContent = line;
        currentHunk.appendChild(hdr);
        container.appendChild(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      var diffLine = document.createElement('div');
      var lineNum = document.createElement('span');
      var content = document.createElement('span');

      lineNum.className = 'diff-line-num';
      content.className = 'content';

      if (line.startsWith('+')) {
        diffLine.className = 'diff-line add';
        lineNum.textContent = newLine;
        content.textContent = line.substring(1);
        newLine++;
      } else if (line.startsWith('-')) {
        diffLine.className = 'diff-line del';
        lineNum.textContent = oldLine;
        content.textContent = line.substring(1);
        oldLine++;
      } else {
        diffLine.className = 'diff-line context';
        lineNum.textContent = newLine;
        content.textContent = line.startsWith(' ') ? line.substring(1) : line;
        oldLine++;
        newLine++;
      }

      diffLine.appendChild(lineNum);
      diffLine.appendChild(content);
      currentHunk.appendChild(diffLine);
    }

    if (currentHunk && currentHunk.children.length <= 1) {
      currentHunk.remove();
    }

    if (container.children.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'diff-no-patch';
      empty.textContent = 'Empty diff';
      container.appendChild(empty);
    }

    return container;
  }

  setupCommentUI();
  vscode.postMessage({ type: 'ready' });
})();
