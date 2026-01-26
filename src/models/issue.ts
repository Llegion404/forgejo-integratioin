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
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
  }>;
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
