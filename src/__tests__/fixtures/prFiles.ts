import { PullRequestFile } from '../../models/pullRequest';

/**
 * Mock data for PullRequestFile objects used in tests
 */

export const mockModifiedFile: PullRequestFile = {
  filename: 'src/utils/helper.ts',
  status: 'modified',
  additions: 10,
  deletions: 5,
  changes: 15,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/utils/helper.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/utils/helper.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/utils/helper.ts',
  patch: '@@ -1,5 +1,10 @@\n-old line\n+new line'
};

export const mockAddedFile: PullRequestFile = {
  filename: 'src/features/newFeature.ts',
  status: 'added',
  additions: 50,
  deletions: 0,
  changes: 50,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/features/newFeature.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/features/newFeature.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/features/newFeature.ts',
  patch: '@@ -0,0 +1,50 @@\n+new file content'
};

export const mockRemovedFile: PullRequestFile = {
  filename: 'src/deprecated/oldCode.ts',
  status: 'removed',
  additions: 0,
  deletions: 30,
  changes: 30,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/deprecated/oldCode.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/deprecated/oldCode.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/deprecated/oldCode.ts',
  patch: '@@ -1,30 +0,0 @@\n-deleted line'
};

export const mockRenamedFile: PullRequestFile = {
  filename: 'src/utils/renamedHelper.ts',
  status: 'renamed',
  additions: 2,
  deletions: 1,
  changes: 3,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/utils/renamedHelper.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/utils/renamedHelper.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/utils/renamedHelper.ts',
  patch: '@@ -1,1 +1,2 @@\n-old line\n+new line',
  previous_filename: 'src/utils/oldHelper.ts'
};

export const mockFileWithSpecialChars: PullRequestFile = {
  filename: 'src/files/file with spaces & special#chars.ts',
  status: 'modified',
  additions: 5,
  deletions: 3,
  changes: 8,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/files/file%20with%20spaces%20%26%20special%23chars.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/files/file%20with%20spaces%20%26%20special%23chars.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/files/file%20with%20spaces%20%26%20special%23chars.ts',
  patch: '@@ -1,3 +1,5 @@\n-old\n+new'
};

export const mockNestedFile: PullRequestFile = {
  filename: 'src/deep/nested/path/to/file.ts',
  status: 'modified',
  additions: 3,
  deletions: 2,
  changes: 5,
  blob_url: 'https://git.example.com/owner/repo/blob/abc123/src/deep/nested/path/to/file.ts',
  raw_url: 'https://git.example.com/owner/repo/raw/abc123/src/deep/nested/path/to/file.ts',
  contents_url: 'https://git.example.com/api/v1/repos/owner/repo/contents/src/deep/nested/path/to/file.ts',
  patch: '@@ -1,2 +1,3 @@\n-old\n+new'
};

/**
 * Array of all file types for comprehensive testing
 */
export const mockAllFileTypes: PullRequestFile[] = [
  mockAddedFile,
  mockModifiedFile,
  mockRenamedFile,
  mockRemovedFile
];

/**
 * Array with mixed order to test sorting
 */
export const mockUnsortedFiles: PullRequestFile[] = [
  mockRemovedFile,
  mockAddedFile,
  mockRenamedFile,
  mockModifiedFile
];

/**
 * Expected sorted order: added → modified → renamed → removed
 */
export const mockSortedFiles: PullRequestFile[] = [
  mockAddedFile,
  mockModifiedFile,
  mockRenamedFile,
  mockRemovedFile
];

/**
 * Empty array for testing empty state
 */
export const mockEmptyFiles: PullRequestFile[] = [];

/**
 * Large array for testing pagination/performance
 */
export const mockLargeFileList: PullRequestFile[] = Array.from({ length: 50 }, (_, i) => ({
  filename: `src/file${i}.ts`,
  status: 'modified' as const,
  additions: i,
  deletions: i,
  changes: i * 2,
  blob_url: `https://git.example.com/owner/repo/blob/abc123/src/file${i}.ts`,
  raw_url: `https://git.example.com/owner/repo/raw/abc123/src/file${i}.ts`,
  contents_url: `https://git.example.com/api/v1/repos/owner/repo/contents/src/file${i}.ts`,
  patch: `@@ -1,${i} +1,${i} @@\n+new line`
}));
