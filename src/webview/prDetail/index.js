(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let modalIdCounter = 0;
  const modalResolvers = new Map();

  // Promise-based modal helpers (postMessage round-trip through the extension)
  function showConfirm(message) {
    return new Promise((resolve) => {
      const id = ++modalIdCounter;
      modalResolvers.set(id, resolve);
      vscode.postMessage({ type: 'showConfirm', id, message });
    });
  }

  function showInputBox(prompt, defaultValue) {
    return new Promise((resolve) => {
      const id = ++modalIdCounter;
      modalResolvers.set(id, resolve);
      vscode.postMessage({ type: 'showInputBox', id, prompt, defaultValue: defaultValue || '' });
    });
  }

  // DOM Elements
  const $ = (id) => document.getElementById(id);
  const loadingEl = $('loading');
  const errorEl = $('error');
  const errorMessageEl = $('error-message');
  const contentEl = $('content');

  const prTitleEl = $('pr-title');
  const prNumberEl = $('pr-number');
  const prStatusBadge = $('pr-status-badge');
  const authorAvatar = $('author-avatar');
  const authorName = $('author-name');
  const baseBranch = $('base-branch');
  const headBranch = $('head-branch');
  const crossRepoBadge = $('cross-repo-badge');

  const checkoutBtn = $('checkout-btn');
  const refreshBtn = $('refresh-btn');
  const openWebBtn = $('open-web-btn');
  const mergeActionsEl = $('merge-actions');
  const mergeBtn = $('merge-btn');
  const revertActionsEl = $('revert-actions');
  const revertBtn = $('revert-btn');
  const reopenPRBtn = $('reopen-pr-btn');
  const toggleDraftBtn = $('toggle-draft-btn');

  const prDescriptionEl = $('pr-description');
  const ciSection = $('ci-section');
  const ciStatusList = $('ci-status-list');
  const ciSummary = $('ci-summary');
  const activityCountEl = $('activity-count');
  const activityTimeline = $('activity-timeline');

  const labelsContainer = $('labels-container');
  const labelsList = $('labels-list');
  const addLabelBtn = $('add-label-btn');
  const assigneesContainer = $('assignees-container');
  const assigneesList = $('assignees-list');
  const addAssigneeBtn = $('add-assignee-btn');
  const reviewersContainer = $('reviewers-container');
  const reviewersList = $('reviewers-list');
  const addReviewerBtn = $('add-reviewer-btn');

  const prCreatedEl = $('pr-created');
  const mergeableBadge = $('pr-mergeable-badge');

  const editDescriptionBtn = $('edit-description-btn');
  const descriptionEditor = $('pr-description-editor');
  const descriptionTextarea = $('description-textarea');
  const saveDescriptionBtn = $('save-description-btn');
  const cancelDescriptionBtn = $('cancel-description-btn');

  const commentInputContainer = $('comment-input-container');
  const commentInput = $('comment-input');
  const submitCommentBtn = $('submit-comment-btn');
  const submitReviewBtn = $('submit-review-btn');

  const reviewDialog = $('review-dialog');
  const reviewState = $('review-state');
  const reviewBody = $('review-body');
  const confirmReviewBtn = $('confirm-review-btn');
  const cancelReviewBtn = $('cancel-review-btn');

  const mergeDialog = $('merge-dialog');
  const mergeStrategy = $('merge-strategy');
  const mergeTitle = $('merge-title');
  const mergeMessage = $('merge-message');
  const confirmMergeBtn = $('confirm-merge-btn');
  const cancelMergeBtn = $('cancel-merge-btn');

  // ======== Init ========
  function init() {
    setupEventListeners();
    setupMessageHandler();
    vscode.postMessage({ type: 'ready' });
  }

  function setupEventListeners() {
    $('retry-btn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    checkoutBtn.addEventListener('click', () => vscode.postMessage({ type: 'checkout' }));
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    openWebBtn.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));

    // Label/assignee/reviewer management -> VS Code QuickPick
    addLabelBtn.addEventListener('click', () => vscode.postMessage({ type: 'manageLabels' }));
    addAssigneeBtn.addEventListener('click', () => vscode.postMessage({ type: 'manageAssignees' }));
    addReviewerBtn.addEventListener('click', () => vscode.postMessage({ type: 'manageReviewers' }));
    $('manage-milestone-btn')?.addEventListener('click', () => vscode.postMessage({ type: 'manageMilestone' }));

    // Delegated × removal for label/assignee/reviewer chips
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const removeLabelBtn = target.closest('[data-action="remove-label"]');
      if (removeLabelBtn?.dataset.label) {
        e.stopPropagation();
        showConfirm('Remove label "' + removeLabelBtn.dataset.label + '"?').then((ok) => {
          if (ok) vscode.postMessage({ type: 'removeLabel', label: removeLabelBtn.dataset.label });
        });
        return;
      }
      const removeAssigneeBtn = target.closest('[data-action="remove-assignee"]');
      if (removeAssigneeBtn?.dataset.assignee) {
        e.stopPropagation();
        showConfirm('Remove assignee "' + removeAssigneeBtn.dataset.assignee + '"?').then((ok) => {
          if (ok) vscode.postMessage({ type: 'removeAssignee', assignee: removeAssigneeBtn.dataset.assignee });
        });
        return;
      }
      const removeReviewerBtn = target.closest('[data-action="remove-reviewer"]');
      if (removeReviewerBtn?.dataset.reviewer) {
        e.stopPropagation();
        showConfirm('Remove reviewer "' + removeReviewerBtn.dataset.reviewer + '"?').then((ok) => {
          if (ok) vscode.postMessage({ type: 'removeReviewer', reviewer: removeReviewerBtn.dataset.reviewer });
        });
        return;
      }
    });

    // Reopen / toggle draft
    reopenPRBtn.addEventListener('click', () => vscode.postMessage({ type: 'reopenPR' }));
    toggleDraftBtn.addEventListener('click', () => vscode.postMessage({ type: 'toggleDraft' }));

    // Merge
    mergeBtn.addEventListener('click', () => { mergeDialog.style.display = 'flex'; mergeStrategy.focus(); });
    confirmMergeBtn.addEventListener('click', () => {
      const strategy = mergeStrategy.value;
      const title = mergeTitle.value.trim() || undefined;
      const message = mergeMessage.value.trim() || undefined;
      const deleteBranch = document.getElementById('merge-delete-branch')?.checked === true;
      confirmMergeBtn.disabled = true;
      confirmMergeBtn.textContent = 'Merging...';
      vscode.postMessage({ type: 'merge', strategy, title, message, deleteBranch });
    });
    cancelMergeBtn.addEventListener('click', () => closeMergeDialog());
    mergeMessage.addEventListener('keydown', modalKeyHandler(() => confirmMergeBtn.click(), () => cancelMergeBtn.click()));

    // Revert
    revertBtn.addEventListener('click', () => {
      if (currentData?.pr?.merge_commit_sha) {
        vscode.postMessage({ type: 'revert', commitSha: currentData.pr.merge_commit_sha });
      }
    });

    // Description editing
    editDescriptionBtn.addEventListener('click', () => {
      if (!currentData?.pr) return;
      descriptionTextarea.value = currentData.pr.body || '';
      prDescriptionEl.style.display = 'none';
      descriptionEditor.style.display = 'block';
      editDescriptionBtn.style.display = 'none';
      descriptionTextarea.focus();
    });
    saveDescriptionBtn.addEventListener('click', () => {
      saveDescriptionBtn.disabled = true;
      saveDescriptionBtn.textContent = 'Saving...';
      vscode.postMessage({ type: 'updateBody', body: descriptionTextarea.value });
    });
    cancelDescriptionBtn.addEventListener('click', () => {
      descriptionEditor.style.display = 'none';
      prDescriptionEl.style.display = 'block';
      editDescriptionBtn.style.display = 'inline-flex';
    });
    descriptionTextarea.addEventListener('keydown', modalKeyHandler(() => saveDescriptionBtn.click(), () => cancelDescriptionBtn.click()));

    // Title editing (click to edit)
    prTitleEl.addEventListener('click', () => {
      if (prTitleEl.contentEditable !== 'true') {
        prTitleEl.contentEditable = 'true';
        prTitleEl.focus();
        const range = document.createRange();
        range.selectNodeContents(prTitleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    prTitleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        prTitleEl.contentEditable = 'false';
        const newTitle = prTitleEl.textContent.trim();
        if (newTitle && currentData?.pr && newTitle !== currentData.pr.title) {
          vscode.postMessage({ type: 'updateTitle', title: newTitle });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        prTitleEl.contentEditable = 'false';
        if (currentData?.pr) prTitleEl.textContent = currentData.pr.title;
      }
    });
    prTitleEl.addEventListener('blur', () => {
      if (prTitleEl.contentEditable === 'true') {
        prTitleEl.contentEditable = 'false';
        if (currentData?.pr) prTitleEl.textContent = currentData.pr.title;
      }
    });

    // Comment composer
    submitCommentBtn.addEventListener('click', () => {
      const body = commentInput.value.trim();
      if (body) {
        submitCommentBtn.disabled = true;
        submitCommentBtn.textContent = 'Submitting...';
        vscode.postMessage({ type: 'addComment', body });
      }
    });
    commentInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitCommentBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commentInput.value = '';
        commentInputContainer.style.display = 'none';
      }
    });
    commentInput.addEventListener('input', function() { autoResize(this); });

    // Review dialog
    submitReviewBtn.addEventListener('click', () => {
      reviewDialog.style.display = 'flex';
      reviewBody.focus();
    });
    confirmReviewBtn.addEventListener('click', () => {
      const state = reviewState.value;
      const body = reviewBody.value.trim();
      confirmReviewBtn.disabled = true;
      confirmReviewBtn.textContent = 'Submitting...';
      vscode.postMessage({ type: 'addReview', state, body });
    });
    cancelReviewBtn.addEventListener('click', () => closeReviewDialog());
    reviewBody.addEventListener('keydown', modalKeyHandler(() => confirmReviewBtn.click(), () => cancelReviewBtn.click()));

    // CI status click → open
    ciStatusList.addEventListener('click', (e) => {
      const item = e.target.closest('.ci-item');
      if (item?.dataset.targetUrl) {
        vscode.postMessage({ type: 'openCIStatus', url: item.dataset.targetUrl });
      }
    });

    // Timeline delegated handler
    activityTimeline.addEventListener('click', handleTimelineClick);

    // Emoji picker
    $('emoji-picker').addEventListener('click', function(e) {
      const opt = e.target.closest('.emoji-option');
      if (opt?.dataset.emoji) {
        const commentId = parseInt(this.dataset.parentCommentId || '0', 10);
        const isPRLevel = this.dataset.isPrLevel === 'true';
        if (isPRLevel) {
          vscode.postMessage({ type: 'addPRReaction', reaction: opt.dataset.emoji });
        } else if (commentId > 0) {
          vscode.postMessage({ type: 'addReaction', commentId, reaction: opt.dataset.emoji });
        }
        this.style.display = 'none';
        this.dataset.isPrLevel = '';
      }
    });

    // Close emoji picker on outside click
    document.addEventListener('click', (e) => {
      const picker = $('emoji-picker');
      if (picker && !e.target.closest('.emoji-picker') && !e.target.closest('.add-reaction-btn')) {
        picker.style.display = 'none';
      }
    });

    // Document-level user link handler
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.user-link');
      if (link?.dataset.username) {
        e.preventDefault();
        vscode.postMessage({ type: 'openUserProfile', username: link.dataset.username });
      }
    });

    // Image lightbox in description + PR-level reaction pills
    prDescriptionEl.addEventListener('click', (e) => {
      const img = e.target.closest('img');
      if (img?.src?.startsWith('http')) {
        e.preventDefault();
        vscode.postMessage({ type: 'openInBrowserFromUrl', url: img.src });
      }
    });

    // PR description-level reactions bar (rendered outside the timeline)
    const prReactionsBar = $('pr-reactions-bar');
    prReactionsBar?.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const pill = target.closest('.reaction-pill');
      if (pill?.dataset.reaction) {
        vscode.postMessage({ type: 'addPRReaction', reaction: pill.dataset.reaction });
        return;
      }
      const addBtn = target.closest('.add-reaction-btn');
      if (addBtn) {
        const picker = $('emoji-picker');
        const rect = addBtn.getBoundingClientRect();
        picker.style.display = 'flex';
        picker.style.position = 'fixed';
        picker.style.left = rect.left + 'px';
        picker.style.top = (rect.bottom + 2) + 'px';
        picker.dataset.parentCommentId = '';
        picker.dataset.isPrLevel = 'true';
      }
    });
  }

  // ======== Message Handler ========
  function setupMessageHandler() {
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          currentData = message.data;
          updatePRDetails(currentData);
          break;
        case 'loading': setLoading(message.show); break;
        case 'error': showError(message.message); break;
        case 'theme': applyTheme(message.theme); break;
        case 'actionComplete': handleActionComplete(message.action, message.success); break;
        case 'bodyUpdated':
          if (currentData?.pr) currentData.pr.body = message.body;
          prDescriptionEl.innerHTML = message.body ? renderMarkdown(message.body) : '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
          setupCheckboxListeners();
          descriptionEditor.style.display = 'none';
          prDescriptionEl.style.display = 'block';
          editDescriptionBtn.style.display = 'inline-flex';
          break;
        case 'modalResult':
          {
            const resolver = modalResolvers.get(message.id);
            if (resolver) {
              modalResolvers.delete(message.id);
              if (typeof message.confirmed === 'boolean') resolver(message.confirmed);
              else resolver(message.value);
            }
          }
          break;
      }
    });
  }

  function handleActionComplete(action, success) {
    switch (action) {
      case 'addComment':
        submitCommentBtn.disabled = false;
        submitCommentBtn.textContent = 'Comment';
        if (success) { commentInput.value = ''; commentInputContainer.style.display = 'none'; }
        break;
      case 'addReview':
        confirmReviewBtn.disabled = false;
        confirmReviewBtn.textContent = 'Submit Review';
        if (success) closeReviewDialog();
        break;
      case 'merge':
        confirmMergeBtn.disabled = false;
        confirmMergeBtn.textContent = 'Merge';
        if (success) closeMergeDialog();
        break;
      case 'editComment':
        // On success: data will refresh from API and replace the DOM.
        // On failure: re-enable Save buttons in any open editors so the user can retry.
        if (!success) {
          document.querySelectorAll('.save-edit-btn').forEach((btn) => {
            btn.disabled = false;
            btn.textContent = 'Save';
          });
        }
        break;
      case 'updateBody':
        saveDescriptionBtn.disabled = false;
        saveDescriptionBtn.textContent = 'Save';
        break;
    }
  }

  // ======== State helpers ========
  function setLoading(show) {
    loadingEl.style.display = show ? 'flex' : 'none';
    contentEl.style.display = show ? 'none' : 'block';
    errorEl.style.display = 'none';
  }

  function showError(message) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function closeMergeDialog() {
    mergeTitle.value = '';
    mergeMessage.value = '';
    mergeDialog.style.display = 'none';
  }

  function closeReviewDialog() {
    reviewBody.value = '';
    reviewDialog.style.display = 'none';
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
  }

  function modalKeyHandler(onEnter, onEscape) {
    return (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onEnter(); }
      else if (e.key === 'Escape') { e.preventDefault(); onEscape(); }
    };
  }

  // ======== Render PR Details ========
  function updatePRDetails(data) {
    const { pr, activities, statuses, owner, repo } = data;

    // Title + number
    prTitleEl.textContent = pr.title || 'Untitled PR';
    prNumberEl.textContent = `#${pr.number || '?'}`;

    // Status badge
    let statusText = pr.state || 'open';
    let statusClass = (pr.state || 'open').toLowerCase();
    if (pr.draft) { statusText = 'Draft'; statusClass = 'draft'; }
    else if (pr.merged) { statusText = 'Merged'; statusClass = 'merged'; }
    prStatusBadge.textContent = statusText;
    prStatusBadge.className = 'status-badge ' + statusClass;

    // Mergeable badge
    if (pr.state === 'open' && !pr.draft) {
      if (pr.mergeable === true) {
        mergeableBadge.textContent = 'Mergeable';
        mergeableBadge.className = 'mergeable-badge yes';
        mergeableBadge.style.display = 'inline-block';
      } else if (pr.mergeable === false) {
        mergeableBadge.textContent = 'Conflicts';
        mergeableBadge.className = 'mergeable-badge no';
        mergeableBadge.style.display = 'inline-block';
      } else {
        mergeableBadge.style.display = 'none';
      }
    } else {
      mergeableBadge.style.display = 'none';
    }

    // Author
    const authorLogin = pr.user?.login || 'Unknown';
    if (pr.user?.avatar_url) {
      authorAvatar.src = pr.user.avatar_url;
      $('author-avatar-link').style.display = 'inline-block';
      $('author-avatar-link').dataset.username = authorLogin;
    } else {
      $('author-avatar-link').style.display = 'none';
    }
    authorName.textContent = authorLogin;
    authorName.dataset.username = authorLogin;

    // Created date
    if (pr.created_at) {
      prCreatedEl.textContent = 'opened ' + formatTimeAgo(pr.created_at);
    }

    // Branches
    if (pr.base) {
      baseBranch.textContent = pr.base.ref || 'unknown';
    }
    if (pr.head) {
      headBranch.textContent = pr.head.ref || 'unknown';
      if (crossRepoBadge && pr.head.repo?.full_name && !pr.head.repo.full_name.startsWith(owner + '/' + repo)) {
        crossRepoBadge.textContent = 'from ' + pr.head.repo.full_name;
        crossRepoBadge.style.display = 'inline';
      } else {
        crossRepoBadge.style.display = 'none';
      }
    }

    // Labels
    if (pr.labels?.length > 0) {
      labelsContainer.style.display = 'block';
      labelsList.innerHTML = pr.labels.map(label => {
        const bgColor = label.color ? '#' + label.color : 'var(--vscode-badge-background)';
        const textColor = getContrastColor(label.color || '000000');
        return `<span class="label-pill" style="background-color:${bgColor};color:${textColor};">${escapeHtml(label.name)}<button class="chip-remove-btn" data-action="remove-label" data-label="${escapeHtml(label.name)}" title="Remove">\u00D7</button></span>`;
      }).join('');
    } else {
      labelsContainer.style.display = 'block';
      labelsList.innerHTML = '<span class="meta-empty">None</span>';
    }

    // Assignees
    if (pr.assignees?.length > 0) {
      assigneesContainer.style.display = 'block';
      assigneesList.innerHTML = pr.assignees.map(a =>
        `<span class="assignee-chip">${escapeHtml(a.login)}<button class="chip-remove-btn" data-action="remove-assignee" data-assignee="${escapeHtml(a.login)}" title="Remove">\u00D7</button></span>`
      ).join('');
    } else {
      assigneesContainer.style.display = 'block';
      assigneesList.innerHTML = '<span class="meta-empty">None</span>';
    }

    // Reviewers
    if (pr.requested_reviewers?.length > 0) {
      reviewersContainer.style.display = 'block';
      reviewersList.innerHTML = pr.requested_reviewers.map(r =>
        `<span class="reviewer-chip">${escapeHtml(r.login)}<button class="chip-remove-btn" data-action="remove-reviewer" data-reviewer="${escapeHtml(r.login)}" title="Remove">\u00D7</button></span>`
      ).join('');
    } else {
      reviewersContainer.style.display = 'block';
      reviewersList.innerHTML = '<span class="meta-empty">None</span>';
    }

    // Milestone (PR)
    const milestoneNameEl = $('milestone-name');
    if (milestoneNameEl) {
      if (pr.milestone?.title) {
        const due = pr.milestone.due_on ? ' — due ' + new Date(pr.milestone.due_on).toLocaleDateString() : '';
        milestoneNameEl.innerHTML = '<span class="milestone-pill">' + escapeHtml(pr.milestone.title) + due + '</span>';
      } else {
        milestoneNameEl.innerHTML = '<span class="meta-empty">No milestone</span>';
      }
    }

    // Description
    if (pr.body) {
      prDescriptionEl.innerHTML = renderMarkdown(pr.body);
      setupCheckboxListeners();
    } else {
      prDescriptionEl.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
    }

    // PR-level reactions on description
    const prReactionsBar = $('pr-reactions-bar');
    if (prReactionsBar) {
      if (data.prReactions && data.prReactions.length > 0) {
        prReactionsBar.innerHTML = ForgejoReactions.render(data.prReactions, escapeHtml);
        prReactionsBar.style.display = 'flex';
      } else {
        prReactionsBar.innerHTML = '<span class="add-reaction-btn" data-pr-level="true" title="Add reaction">+ Add reaction</span>';
        prReactionsBar.style.display = 'flex';
      }
    }
    descriptionEditor.style.display = 'none';
    prDescriptionEl.style.display = 'block';
    editDescriptionBtn.style.display = 'inline-flex';

    // CI status
    if (statuses?.length > 0) {
      ciSection.style.display = 'block';
      const passed = statuses.filter(s => s.status === 'success').length;
      const failed = statuses.filter(s => s.status === 'error' || s.status === 'failure').length;
      ciSummary.textContent = `${passed}/${statuses.length} passed` + (failed > 0 ? ` · ${failed} failed` : '');
      ciStatusList.innerHTML = statuses.map(status => {
        const statusClass = status.status || 'pending';
        const icon = statusIconFor(statusClass);
        const timeAgo = formatTimeAgo(status.updated_at || status.created_at);
        return `<div class="ci-item ${statusClass}" data-target-url="${escapeHtml(status.target_url || '')}">
          <span class="ci-icon">${icon}</span>
          <span class="ci-context">${escapeHtml(status.context || 'Unknown')}</span>
          <span class="ci-meta">${timeAgo}</span>
        </div>`;
      }).join('');
    } else {
      ciSection.style.display = 'none';
    }

    // Action buttons
    if (pr.state === 'open' && !pr.draft) {
      mergeActionsEl.style.display = 'flex';
      revertActionsEl.style.display = 'none';
      reopenPRBtn.style.display = 'none';
      toggleDraftBtn.style.display = 'inline-flex';
      toggleDraftBtn.textContent = 'Convert to Draft';
    } else if (pr.state === 'open' && pr.draft) {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'none';
      reopenPRBtn.style.display = 'none';
      toggleDraftBtn.style.display = 'inline-flex';
      toggleDraftBtn.textContent = 'Ready for Review';
    } else if (pr.merged) {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'flex';
      reopenPRBtn.style.display = 'none';
      toggleDraftBtn.style.display = 'none';
    } else {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'none';
      reopenPRBtn.style.display = 'inline-flex';
      toggleDraftBtn.style.display = 'none';
    }

    // Always show comment composer
    commentInputContainer.style.display = 'flex';

    // Activity timeline
    const activityCount = activities?.length || 0;
    activityCountEl.textContent = `(${activityCount} events)`;

    // Clear existing timeline items (keep the line)
    activityTimeline.querySelectorAll('.timeline-item').forEach(el => el.remove());

    if (activities?.length > 0) {
      const html = activities.map(a => renderActivity(a)).join('');
      const line = activityTimeline.querySelector('.timeline-line');
      if (line) {
        line.insertAdjacentHTML('afterend', html);
      } else {
        activityTimeline.innerHTML += html;
      }
    } else {
      activityTimeline.innerHTML += '<div class="timeline-item"><div class="timeline-body"><span style="color:var(--vscode-descriptionForeground)">No activity yet</span></div></div>';
    }

    setLoading(false);
  }

  // ======== Timeline rendering ========
  function renderActivity(activity) {
    const timeAgo = formatTimeAgo(activity.created_at || activity.submitted_at || activity.committed_at);
    const userLogin = activity.user?.login || 'Unknown';
    const userAvatar = activity.user?.avatar_url || '';

    if (activity.type === 'comment') {
      return `<div class="timeline-item" data-comment-id="${activity.id}">
        <div class="timeline-marker comment" title="Comment"></div>
        <div class="timeline-header">
          ${makeUserLink(userLogin)}
          <span class="timeline-action">commented</span>
          <span class="timeline-time" title="${escapeHtml(activity.created_at || '')}">${timeAgo}</span>
          <span class="comment-actions">
            <button class="comment-action reply-comment-btn" title="Reply">Reply</button>
            <button class="comment-action edit-comment-btn" title="Edit">Edit</button>
            <button class="comment-action copy-comment-btn" title="Copy">Copy</button>
            <button class="comment-action delete-comment-btn" title="Delete">Delete</button>
          </span>
        </div>
        <div class="timeline-body">
          ${activity.body ? `<div class="markdown-body collapsible${activity.body.length > 800 ? ' collapsed' : ''}">${renderMarkdown(activity.body)}</div>${activity.body.length > 800 ? '<button class="show-more-btn">Show more</button>' : ''}` : ''}
          <div class="edit-comment-editor" style="display:none;">
            <textarea class="comment-edit-textarea">${escapeHtml(activity.body || '')}</textarea>
            <div class="editor-actions" style="margin-top:8px;">
              <button class="btn btn-primary btn-sm save-edit-btn">Save</button>
              <button class="btn btn-secondary btn-sm cancel-edit-btn">Cancel</button>
            </div>
          </div>
          ${activity.reactions?.length ? renderReactions(activity.reactions) : ''}
        </div>
      </div>`;
    }

    if (activity.type === 'review') {
      const reviewClass = activity.state === 'APPROVED' ? 'approved' :
                          activity.state === 'REQUEST_CHANGES' ? 'changes' : 'review';
      const reviewStateText = activity.state ? activity.state.toLowerCase().replace(/_/g, ' ') : 'commented';
      return `<div class="timeline-item">
        <div class="timeline-marker ${reviewClass}" title="${reviewStateText}"></div>
        <div class="timeline-header">
          ${makeUserLink(userLogin)}
          <span class="timeline-action">reviewed:</span>
          <span class="review-state ${reviewClass}">${reviewStateText}</span>
          <span class="timeline-time" title="${escapeHtml(activity.submitted_at || '')}">${timeAgo}</span>
        </div>
        ${activity.body ? '<div class="timeline-body"><div class="markdown-body">' + renderMarkdown(activity.body) + '</div></div>' : ''}
      </div>`;
    }

    if (activity.type === 'commit') {
      const shortSha = activity.sha ? activity.sha.substring(0, 7) : '';
      return `<div class="timeline-item">
        <div class="timeline-marker commit" title="Commit"></div>
        <div class="timeline-header">
          ${makeUserLink(userLogin)}
          <span class="timeline-action">committed</span>
          <span class="commit-sha" data-sha="${escapeHtml(activity.sha || '')}">${shortSha}</span>
          <span class="timeline-time" title="${escapeHtml(activity.committed_at || '')}">${timeAgo}</span>
        </div>
        ${activity.message ? '<div class="timeline-body"><span>' + escapeHtml(activity.message) + '</span></div>' : ''}
      </div>`;
    }

    if (activity.type === 'timeline') {
      return `<div class="timeline-item">
        <div class="timeline-marker" title="Event"></div>
        <div class="timeline-header">
          ${makeUserLink(userLogin)}
          <span class="timeline-action">${renderTimelineEvent(activity)}</span>
          <span class="timeline-time" title="${escapeHtml(activity.created_at || '')}">${timeAgo}</span>
        </div>
      </div>`;
    }

    return '';
  }

  function handleTimelineClick(e) {
    // User link
    const userLink = e.target.closest('.user-link');
    if (userLink?.dataset.username) {
      e.preventDefault();
      vscode.postMessage({ type: 'openUserProfile', username: userLink.dataset.username });
      return;
    }

    // Reaction toggle
    const reactionPill = e.target.closest('.reaction-pill');
    if (reactionPill?.dataset.reaction) {
      const item = reactionPill.closest('[data-comment-id]');
      if (item?.dataset.commentId) {
        const commentId = parseInt(item.dataset.commentId, 10);
        const reacted = reactionPill.classList.contains('reacted-by-me');
        vscode.postMessage({
          type: reacted ? 'removeReaction' : 'addReaction',
          commentId, reaction: reactionPill.dataset.reaction
        });
      }
      return;
    }

    // Add reaction button
    const addBtn = e.target.closest('.add-reaction-btn');
    if (addBtn) {
      const picker = $('emoji-picker');
      const rect = addBtn.getBoundingClientRect();
      picker.style.display = 'flex';
      picker.style.position = 'fixed';
      picker.style.left = rect.left + 'px';
      picker.style.top = (rect.bottom + 2) + 'px';
      picker.dataset.parentCommentId = addBtn.closest('[data-comment-id]')?.dataset.commentId || '';
      picker.dataset.isPrLevel = addBtn.dataset.prLevel === 'true' ? 'true' : '';
      return;
    }

    // Copy comment
    const copyBtn = e.target.closest('.copy-comment-btn');
    if (copyBtn) {
      const bodyEl = copyBtn.closest('.timeline-item')?.querySelector('.markdown-body');
      if (bodyEl) {
        navigator.clipboard.writeText(bodyEl.textContent || '');
        copyBtn.textContent = '\u2713';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }
      return;
    }

    // Reply
    const replyBtn = e.target.closest('.reply-comment-btn');
    if (replyBtn) {
      const item = replyBtn.closest('[data-comment-id]');
      const bodyEl = item?.querySelector('.markdown-body');
      const origUser = item?.querySelector('.user-link')?.textContent || 'User';
      const origText = bodyEl?.textContent || '';
      const quoted = origText.split('\n').map(l => '> ' + l).join('\n');
      commentInput.value = quoted + '\n\n';
      commentInputContainer.style.display = 'flex';
      commentInput.focus();
      commentInput.scrollTop = commentInput.scrollHeight;
      return;
    }

    // Edit comment
    const editBtn = e.target.closest('.edit-comment-btn');
    if (editBtn) {
      const bodyEl = editBtn.closest('.timeline-body')?.querySelector('.markdown-body');
      const editorEl = editBtn.closest('.timeline-body')?.querySelector('.edit-comment-editor');
      if (bodyEl && editorEl) {
        bodyEl.style.display = 'none';
        editorEl.style.display = 'block';
        editorEl.querySelector('.comment-edit-textarea')?.focus();
      }
      return;
    }

    // Save edit
    const saveBtn = e.target.closest('.save-edit-btn');
    if (saveBtn) {
      const editorEl = saveBtn.closest('.edit-comment-editor');
      const commentId = parseInt(editorEl?.closest('[data-comment-id]')?.dataset.commentId || '0', 10);
      if (editorEl && commentId > 0) {
        const newBody = editorEl.querySelector('.comment-edit-textarea').value;
        vscode.postMessage({ type: 'editComment', commentId, body: newBody });
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      return;
    }

    // Cancel edit
    const cancelEditBtn = e.target.closest('.cancel-edit-btn');
    if (cancelEditBtn) {
      const editorEl = cancelEditBtn.closest('.edit-comment-editor');
      if (editorEl) {
        editorEl.style.display = 'none';
        const bodyEl = editorEl.closest('.timeline-body')?.querySelector('.markdown-body');
        if (bodyEl) bodyEl.style.display = 'block';
      }
      return;
    }

    // Show more
    const expandBtn = e.target.closest('.show-more-btn');
    if (expandBtn) {
      const bodyEl = expandBtn.closest('.timeline-body')?.querySelector('.collapsible');
      if (bodyEl) {
        bodyEl.classList.remove('collapsed');
        expandBtn.remove();
      }
      return;
    }

    // Delete comment
    const deleteBtn = e.target.closest('.delete-comment-btn');
    if (deleteBtn) {
      const item = deleteBtn.closest('[data-comment-id]');
      if (item?.dataset.commentId) {
        const commentId = parseInt(item.dataset.commentId, 10);
        showConfirm('Delete this comment?').then((ok) => {
          if (ok) vscode.postMessage({ type: 'deleteComment', commentId });
        });
      }
      return;
    }

    // Commit SHA click
    const shaEl = e.target.closest('.commit-sha');
    if (shaEl?.dataset.sha) {
      vscode.postMessage({ type: 'viewCommit', sha: shaEl.dataset.sha });
      return;
    }
  }

  // ======== Checkboxes in markdown ========
  function toggleCheckboxInBody(body, checkboxIndex, checked) {
    let count = 0;
    return body.replace(/- \[[ xX]\]/g, (match) => {
      if (count++ === checkboxIndex) return checked ? '- [x]' : '- [ ]';
      return match;
    });
  }

  function setupCheckboxListeners() {
    prDescriptionEl.querySelectorAll('.task-checkbox').forEach((checkbox, index) => {
      checkbox.addEventListener('change', (e) => {
        if (currentData?.pr?.body) {
          const newBody = toggleCheckboxInBody(currentData.pr.body, index, e.target.checked);
          currentData.pr.body = newBody;
          vscode.postMessage({ type: 'updateBody', body: newBody });
        }
      });
    });
  }

  // ======== Helpers ========
  function makeUserLink(login) {
    return `<a class="user-link" href="#" data-username="${escapeHtml(login)}">${escapeHtml(login)}</a>`;
  }

  function renderReactions(reactions) {
    if (!reactions?.length) return '';
    const counts = {};
    const users = {};
    reactions.forEach(r => {
      counts[r.reaction] = (counts[r.reaction] || 0) + 1;
      if (!users[r.reaction]) users[r.reaction] = [];
      users[r.reaction].push(r.user?.login || '');
    });
    const emojiMap = {
      '+1': '\u{1F44D}', '-1': '\u{1F44E}', 'laugh': '\u{1F604}',
      'hooray': '\u{1F389}', 'confused': '\u{1F615}', 'heart': '\u2764\uFE0F',
      'rocket': '\u{1F680}', 'eyes': '\u{1F440}'
    };
    let html = '<div class="reactions-bar">';
    Object.keys(counts).sort().forEach(r => {
      const emoji = emojiMap[r] || r;
      html += `<span class="reaction-pill" data-reaction="${escapeHtml(r)}" title="${escapeHtml(users[r].join(', '))}">${emoji} ${counts[r]}</span>`;
    });
    html += '<span class="add-reaction-btn" title="Add reaction">+</span></div>';
    return html;
  }

  function renderTimelineEvent(activity) {
    if (!activity.event) return 'performed an action';
    const events = {
      'close': 'closed this', 'reopen': 'reopened this', 'comment': 'commented',
      'label': 'changed a label', 'milestone': 'changed the milestone',
      'assignees': 'changed assignees', 'change_title': 'changed the title',
      'delete_branch': 'deleted the head branch', 'merge_pull': 'merged this',
      'review': 'submitted a review', 'review_request': 'requested a review',
      'dismiss_review': 'dismissed a review', 'lock': 'locked this', 'unlock': 'unlocked this',
      'pin': 'pinned this', 'unpin': 'unpinned this',
      'change_target_branch': 'changed the target branch', 'pull_push': 'pushed commits',
      'commit_ref': 'referenced this', 'issue_ref': 'referenced this',
      'comment_ref': 'referenced this', 'pull_ref': 'referenced this',
      'code': 'commented on code', 'project': 'changed the project',
      'project_board': 'moved in project board', 'added_deadline': 'added a deadline',
      'modified_deadline': 'modified the deadline', 'removed_deadline': 'removed the deadline',
      'add_dependency': 'added a dependency', 'remove_dependency': 'removed a dependency',
      'start_tracking': 'started time tracking', 'stop_tracking': 'stopped time tracking',
      'add_time_manual': 'added tracked time', 'cancel_tracking': 'cancelled time tracking',
      'delete_time_manual': 'removed tracked time', 'change_issue_ref': 'changed the issue reference',
      'pull_scheduled_merge': 'scheduled auto-merge', 'pull_cancel_scheduled_merge': 'cancelled auto-merge',
      'closed': 'closed this', 'merged': 'merged this', 'reopened': 'reopened this',
      'reviewed': 'submitted a review', 'approved': 'approved this', 'rejected': 'requested changes',
      'commented': 'commented', 'labeled': 'added a label', 'unlabeled': 'removed a label',
      'milestoned': 'added to a milestone', 'demilestoned': 'removed from a milestone',
      'referenced': 'referenced this', 'assigned': 'was assigned', 'unassigned': 'was unassigned',
      'locked': 'locked this', 'unlocked': 'unlocked this',
      'pinned': 'pinned this', 'unpinned': 'unpinned this',
      'head_ref_deleted': 'deleted the head branch', 'head_ref_restored': 'restored the head branch',
      'marked_ready_for_review': 'marked as ready for review', 'converted_to_draft': 'converted to draft'
    };
    let eventText = events[activity.event] || activity.event;
    if (activity.event === 'label' && activity.label) {
      eventText = 'changed label <strong>' + escapeHtml(activity.label.name || '') + '</strong>';
    }
    if (activity.event === 'change_title' && activity.old_title && activity.new_title) {
      eventText = 'renamed from <del>' + escapeHtml(activity.old_title) + '</del> to <strong>' + escapeHtml(activity.new_title) + '</strong>';
    }
    if (activity.event === 'assignees' && activity.assignee) {
      eventText = (activity.removed_assignee ? 'unassigned ' : 'assigned ') + '<strong>' + escapeHtml(activity.assignee.login || '') + '</strong>';
    }
    if (activity.event === 'milestone' && activity.milestone) {
      eventText = 'set milestone to <strong>' + escapeHtml(activity.milestone.title || '') + '</strong>';
    }
    return eventText;
  }

  function statusIconFor(status) {
    return { 'pending': '\u23F3', 'success': '\u2705', 'error': '\u274C', 'failure': '\u274C', 'warning': '\u26A0\uFE0F' }[status] || '\u23F3';
  }

  function getContrastColor(hexColor) {
    let hex = (hexColor || '000000').replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function applyTheme(theme) {
    document.body.className = '';
    if (theme === 'light') document.body.classList.add('vscode-light');
    else if (theme === 'dark') document.body.classList.add('vscode-dark');
    else if (theme === 'high-contrast') document.body.classList.add('vscode-high-contrast');
  }

  // ======== Markdown Renderer (preserved from original) ========
  function renderMarkdown(text) {
    if (!text) return '';
    var html = escapeHtml(text);
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_match, lang, code) {
      var langAttr = lang ? ' class="language-' + lang + '"' : '';
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code' + langAttr + '>' + code + '</code></pre>');
      return '\n%%CODEBLOCK_' + idx + '%%\n';
    });
    var inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, function(_match, code) {
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

  function processBlockquoteContent(lines) {
    return lines.map(function(line) { return line.trim() === '' ? '' : '<p>' + processInline(line) + '</p>'; }).join('\n');
  }

  function sanitizeUrl(url) {
    var t = (url || '').trim().toLowerCase();
    if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('mailto:')) return url.trim();
    return '';
  }

  function processInline(text) {
    if (!text) return '';
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_m, alt, url) { var s = sanitizeUrl(url); return s ? '<img src="' + s + '" alt="' + alt + '" style="max-width:100%;">' : alt; });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_m, lt, url) { var s = sanitizeUrl(url); return s ? '<a href="' + s + '">' + lt + '</a>' : lt; });
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return text;
  }

  function buildTable(lines) {
    if (lines.length < 2) return lines.map(function(l) { return '<p>' + processInline(l) + '</p>'; }).join('\n');
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
    var tableHtml = '<table>\n<thead>\n<tr>';
    for (var h = 0; h < headerCells.length; h++) {
      var alignAttr = alignments[h] ? ' style="text-align:' + alignments[h] + '"' : '';
      tableHtml += '<th' + alignAttr + '>' + processInline(headerCells[h].trim()) + '</th>';
    }
    tableHtml += '</tr>\n</thead>\n<tbody>';
    for (var r = bodyStartIndex; r < lines.length; r++) {
      var cells = parseTableRow(lines[r]);
      tableHtml += '\n<tr>';
      for (var c = 0; c < cells.length; c++) {
        var ca = alignments[c] ? ' style="text-align:' + alignments[c] + '"' : '';
        tableHtml += '<td' + ca + '>' + processInline(cells[c].trim()) + '</td>';
      }
      tableHtml += '</tr>';
    }
    return tableHtml + '\n</tbody>\n</table>';
  }

  function parseTableRow(row) {
    return row.replace(/^\|/, '').replace(/\|$/, '').split('|');
  }

  // Start
  init();
})();
