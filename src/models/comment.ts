// Re-export shared types from forgejo-ts
export type {
  ReviewComment,
  PullReview,
  CreatePullReviewComment,
  CreatePullReviewOptions,
} from 'forgejo-ts';

// VS Code extension-specific type (not in forgejo-ts)
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  filePath: string;
}

export interface Reaction {
  id: number;
  user: {
    login: string;
    avatar_url?: string;
  };
  reaction: string;
  comment_id?: number;
}

export type ReactionEmoji = '+1' | '-1' | 'laugh' | 'hooray' | 'confused' | 'heart' | 'rocket' | 'eyes';

export const EMOJI_MAP: Record<ReactionEmoji, string> = {
  '+1': '\u{1F44D}',
  '-1': '\u{1F44E}',
  'laugh': '\u{1F604}',
  'hooray': '\u{1F389}',
  'confused': '\u{1F615}',
  'heart': '\u2764\uFE0F',
  'rocket': '\u{1F680}',
  'eyes': '\u{1F440}',
};

export const REACTION_EMOJIS: ReactionEmoji[] = ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'];

export function emojiForReaction(reaction: string): string {
  return EMOJI_MAP[reaction as ReactionEmoji] || reaction;
}

export function reactionNameForEmoji(emoji: string, reactionName: string): string {
  return reactionName;
}

export interface PendingReviewComment {
  path: string;
  line: number;
  body: string;
  id: string;
}

export interface PendingReview {
  prIdentifier: string;
  comments: PendingReviewComment[];
  state: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null;
  body: string;
}
