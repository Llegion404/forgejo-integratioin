export interface PullRequest {
  id: number;
  number: number;
  title: string;
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
    repo: {
      full_name: string;
    };
  };
  base: {
    ref: string;
  };
  mergeable: boolean;
  merged: boolean;
  draft: boolean;
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
}
