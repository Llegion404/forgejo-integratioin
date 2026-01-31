export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
  html_url: string;
  head: {
    ref: string;
    sha: string;
    repo: {
      full_name: string;
    };
  };
  base: {
    ref: string;
  };
  mergeable: boolean;
  merged: boolean;
  merge_commit_sha: string | null;
  draft: boolean;
  comments: number;
  labels: Array<{
    name: string;
    color: string;
  }>;
}

export interface PullRequestListItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: {
    login: string;
  };
  html_url: string;
  created_at: string;
  merged: boolean;
  draft: boolean;
  comments: number;
}

/**
 * Represents a single file changed in a PR
 * Returned by the /pulls/{number}/files API endpoint
 */
export interface PullRequestFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

/**
 * Response from file contents API
 */
export interface FileContentsResponse {
  content: string;
  encoding: string;
  name: string;
  path: string;
  sha: string;
  size: number;
}

/**
 * Commit status check from CI/CD
 */
export interface CommitStatus {
  id: number;
  status: 'pending' | 'success' | 'error' | 'failure' | 'warning';
  context: string;
  description: string;
  target_url: string;
  created_at: string;
  updated_at: string;
}
