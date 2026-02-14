export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number;
  old_position?: number;
  new_position?: number;
  diff_hunk?: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url?: string };
  pull_request_review_id: number;
}

export interface PullReview {
  id: number;
  state: string;
  body: string;
  user: { login: string; avatar_url?: string };
  submitted_at: string;
  html_url: string;
  comments_count?: number;
}

export interface CreatePullReviewComment {
  body: string;
  path: string;
  new_position: number;
  old_position?: number;
}

export interface CreatePullReviewOptions {
  body?: string;
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  comments?: CreatePullReviewComment[];
}

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  filePath: string;
}
