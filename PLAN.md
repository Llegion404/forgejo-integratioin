# Forgejo VS Code Extension — UX Improvement Plan

## Overview
Improve the functionality and UX of the Forgejo VS Code extension with support for reactions/emojis on comments, clickable user profiles, image lightbox, Forgejo-style pending reviews, and general UX polish.

---

## 1. Reactions/Emojis on Comments

**Problem:** No emoji reaction support exists on comments/PRs/issues.

**Implementation:**
- Add reaction API methods to `ForgejoClient` (POST/DELETE reactions)
- Add `Reaction` interface to models
- Add reactions field to `PRActivity` and `IssueActivity`
- Webview UI: render existing reactions as emoji+count badges below each comment
- Add emoji picker popover (👍 👎 😄 🎉 😕 ❤️ 🚀 👀)
- Toggle reactions on click
- New message types: `addReaction`, `removeReaction`

---

## 2. Clickable Usernames → Open Browser Profile

**Problem:** Usernames/avatars are static text/images.

**Implementation:**
- Wrap username/avatar in `<a>` tags that post `openUserProfile` message
- Extension opens `{instanceUrl}/{username}` in external browser
- Apply to: PR/Issue authors, activity commenters, assignees

---

## 3. Image Rendering Improvements

**Problem:** Images render in markdown but no click-to-enlarge.

**Implementation:**
- Click handler on images in markdown body → open in browser
- Better error styling for broken images
- Image loading skeleton placeholder CSS

---

## 4. Forgejo-style Pending Reviews

**Problem:** Inline comments submit immediately; no batch review workflow.

**Implementation:**
- `PendingReviewManager` class to track pending inline comments per PR
- When user starts adding inline comments, create a pending review
- "Submit Review" button posts all pending comments + review body
- "Cancel Review" discards all pending comments
- Pending comments count badge in UI

---

## 5. UX Polish

- Copy comment body button
- Comment timestamps as tooltips (full ISO date)
- Reply to comments (quoted reply in textarea)
- Edit own comments (PATCH endpoint)

---

## Execution Order

1. Reactions/Emojis
2. Clickable usernames
3. Image lightbox
4. Pending reviews
5. UX polish
