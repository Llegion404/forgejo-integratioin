export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  user: {
    login: string;
    avatar_url: string;
  };
  labels: {
    name: string;
    color: string;
  }[];
  assignees: {
    login: string;
  }[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  comments: number;
}

export interface IssueListItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: {
    login: string;
  };
  html_url: string;
  created_at: string;
  comments: number;
  pull_request?: {
    // This field exists if the issue is actually a PR
    url: string;
  };
}

/**
 * A comment on an issue or pull request
 */
export interface IssueComment {
  id: number;
  body: string;
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  html_url: string;
}

/**
 * A timeline event on an issue or pull request
 */
export interface TimelineEvent {
  id: number;
  event: string;
  created_at: string;
  user: {
    login: string;
    avatar_url: string;
  };
  label?: {
    name: string;
    color: string;
  };
  assignee?: {
    login: string;
    avatar_url: string;
  };
  milestone?: {
    title: string;
  };
}
