import { CommitStatus } from '../../models/pullRequest';

/**
 * Mock data for commit statuses used in tests
 */

export const mockStatusSuccess: CommitStatus = {
  id: 1,
  status: 'success',
  context: 'ci/build',
  description: 'Build passed',
  target_url: 'https://ci.example.com/builds/123',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:05:00Z'
};

export const mockStatusPending: CommitStatus = {
  id: 2,
  status: 'pending',
  context: 'ci/test',
  description: 'Running tests...',
  target_url: 'https://ci.example.com/builds/124',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z'
};

export const mockStatusFailure: CommitStatus = {
  id: 3,
  status: 'failure',
  context: 'ci/lint',
  description: 'Linting failed',
  target_url: 'https://ci.example.com/builds/125',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:02:00Z'
};

export const mockStatusError: CommitStatus = {
  id: 4,
  status: 'error',
  context: 'ci/deploy',
  description: 'Deployment error',
  target_url: 'https://ci.example.com/builds/126',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:03:00Z'
};

export const mockStatusWarning: CommitStatus = {
  id: 5,
  status: 'warning',
  context: 'security/scan',
  description: 'Security warnings found',
  target_url: 'https://security.example.com/scans/127',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:04:00Z'
};

export const mockAllStatuses: CommitStatus[] = [
  mockStatusSuccess,
  mockStatusPending,
  mockStatusFailure,
  mockStatusError,
  mockStatusWarning
];

export const mockAllSuccessStatuses: CommitStatus[] = [
  mockStatusSuccess,
  { ...mockStatusSuccess, id: 6, context: 'ci/integration' }
];

export const mockMixedStatuses: CommitStatus[] = [
  mockStatusSuccess,
  mockStatusPending,
  mockStatusFailure
];

export const mockEmptyStatuses: CommitStatus[] = [];
