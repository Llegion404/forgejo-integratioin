/**
 * Mock data for PR activities used in tests
 */

export const mockComment = {
  id: 1,
  body: 'This looks good to me!',
  user: {
    login: 'reviewer1',
    avatar_url: 'https://git.example.com/avatars/reviewer1'
  },
  created_at: '2024-01-15T10:30:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42#issuecomment-1'
};

export const mockCommentWithMarkdown = {
  id: 2,
  body: '## Review Notes\n\n- Fixed the **important** bug\n- Added `tests`\n\n[Link to docs](https://example.com)',
  user: {
    login: 'reviewer2',
    avatar_url: 'https://git.example.com/avatars/reviewer2'
  },
  created_at: '2024-01-15T11:00:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42#issuecomment-2'
};

export const mockComments = [mockComment, mockCommentWithMarkdown];

export const mockReviewApproved = {
  id: 10,
  state: 'APPROVED',
  body: 'LGTM!',
  user: {
    login: 'maintainer',
    avatar_url: 'https://git.example.com/avatars/maintainer'
  },
  submitted_at: '2024-01-15T12:00:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42#pullrequestreview-10'
};

export const mockReviewChangesRequested = {
  id: 11,
  state: 'REQUEST_CHANGES',
  body: 'Please add error handling for edge cases.',
  user: {
    login: 'senior-dev',
    avatar_url: 'https://git.example.com/avatars/senior-dev'
  },
  submitted_at: '2024-01-15T09:00:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42#pullrequestreview-11'
};

export const mockReviewComment = {
  id: 12,
  state: 'COMMENT',
  body: 'Just a general observation.',
  user: {
    login: 'contributor',
    avatar_url: 'https://git.example.com/avatars/contributor'
  },
  submitted_at: '2024-01-15T08:30:00Z',
  html_url: 'https://git.example.com/owner/repo/pulls/42#pullrequestreview-12'
};

export const mockReviews = [mockReviewApproved, mockReviewChangesRequested, mockReviewComment];

export const mockCommit = {
  sha: 'abc123def456789',
  commit: {
    message: 'feat: add new feature',
    author: {
      name: 'Developer',
      email: 'dev@example.com',
      date: '2024-01-14T15:00:00Z'
    }
  },
  author: {
    login: 'developer',
    avatar_url: 'https://git.example.com/avatars/developer'
  },
  html_url: 'https://git.example.com/owner/repo/commit/abc123def456789'
};

export const mockCommitWithLongMessage = {
  sha: 'def456abc789012',
  commit: {
    message: 'fix: resolve critical bug in authentication flow\n\nThis commit fixes the issue where users were being logged out unexpectedly.',
    author: {
      name: 'Developer',
      email: 'dev@example.com',
      date: '2024-01-14T16:00:00Z'
    }
  },
  author: {
    login: 'developer',
    avatar_url: 'https://git.example.com/avatars/developer'
  },
  html_url: 'https://git.example.com/owner/repo/commit/def456abc789012'
};

export const mockCommits = [mockCommit, mockCommitWithLongMessage];

export const mockTimelineEventLabeled = {
  id: 100,
  event: 'labeled',
  created_at: '2024-01-14T10:00:00Z',
  user: {
    login: 'maintainer',
    avatar_url: 'https://git.example.com/avatars/maintainer'
  },
  label: {
    name: 'enhancement',
    color: '84b6eb'
  }
};

export const mockTimelineEventAssigned = {
  id: 101,
  event: 'assigned',
  created_at: '2024-01-14T10:30:00Z',
  user: {
    login: 'project-lead',
    avatar_url: 'https://git.example.com/avatars/project-lead'
  },
  assignee: {
    login: 'developer',
    avatar_url: 'https://git.example.com/avatars/developer'
  }
};

export const mockTimelineEventMilestoned = {
  id: 102,
  event: 'milestoned',
  created_at: '2024-01-14T11:00:00Z',
  user: {
    login: 'maintainer',
    avatar_url: 'https://git.example.com/avatars/maintainer'
  },
  milestone: {
    title: 'v1.0.0'
  }
};

export const mockTimeline = [
  mockTimelineEventLabeled,
  mockTimelineEventAssigned,
  mockTimelineEventMilestoned
];

export const mockEmptyActivities = {
  comments: [],
  reviews: [],
  commits: [],
  timeline: []
};
