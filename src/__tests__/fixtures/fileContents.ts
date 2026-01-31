import { FileContentsResponse } from '../../models/pullRequest';

/**
 * Mock data for file contents and API responses
 */

export const mockPlainTextContent = `export function helper() {
  console.log('Hello, world!');
  return 42;
}`;

export const mockModifiedContent = `export function helper() {
  console.log('Hello, updated world!');
  const result = 42;
  return result;
}`;

export const mockAddedFileContent = `export function newFeature() {
  // Brand new feature
  return true;
}`;

export const mockRemovedFileContent = `export function oldCode() {
  // This code is deprecated
  return false;
}`;

/**
 * Base64 encoded version of mockPlainTextContent
 */
export const mockBase64Content = Buffer.from(mockPlainTextContent).toString('base64');

/**
 * Base64 encoded version of mockModifiedContent
 */
export const mockBase64ModifiedContent = Buffer.from(mockModifiedContent).toString('base64');

/**
 * Base64 encoded version of mockAddedFileContent
 */
export const mockBase64AddedContent = Buffer.from(mockAddedFileContent).toString('base64');

/**
 * Base64 encoded version of mockRemovedFileContent
 */
export const mockBase64RemovedContent = Buffer.from(mockRemovedFileContent).toString('base64');

/**
 * Mock FileContentsResponse with base64 encoding
 */
export const mockFileContentsResponseBase64: FileContentsResponse = {
  content: mockBase64Content,
  encoding: 'base64',
  name: 'helper.ts',
  path: 'src/utils/helper.ts',
  sha: 'abc123def456',
  size: mockPlainTextContent.length
};

/**
 * Mock FileContentsResponse with plain text
 */
export const mockFileContentsResponsePlain: FileContentsResponse = {
  content: mockPlainTextContent,
  encoding: 'utf-8',
  name: 'helper.ts',
  path: 'src/utils/helper.ts',
  sha: 'abc123def456',
  size: mockPlainTextContent.length
};

/**
 * Mock response for modified file (base ref)
 */
export const mockFileContentsBase: FileContentsResponse = {
  content: mockBase64Content,
  encoding: 'base64',
  name: 'helper.ts',
  path: 'src/utils/helper.ts',
  sha: 'oldsha123',
  size: mockPlainTextContent.length
};

/**
 * Mock response for modified file (head ref)
 */
export const mockFileContentsHead: FileContentsResponse = {
  content: mockBase64ModifiedContent,
  encoding: 'base64',
  name: 'helper.ts',
  path: 'src/utils/helper.ts',
  sha: 'newsha456',
  size: mockModifiedContent.length
};

/**
 * Mock response for added file
 */
export const mockFileContentsAdded: FileContentsResponse = {
  content: mockBase64AddedContent,
  encoding: 'base64',
  name: 'newFeature.ts',
  path: 'src/features/newFeature.ts',
  sha: 'newfile789',
  size: mockAddedFileContent.length
};

/**
 * Mock response for removed file
 */
export const mockFileContentsRemoved: FileContentsResponse = {
  content: mockBase64RemovedContent,
  encoding: 'base64',
  name: 'oldCode.ts',
  path: 'src/deprecated/oldCode.ts',
  sha: 'oldfile999',
  size: mockRemovedFileContent.length
};

/**
 * Mock response for file with special characters
 */
export const mockFileContentsSpecialChars: FileContentsResponse = {
  content: Buffer.from('// File with special chars\nexport const test = true;').toString('base64'),
  encoding: 'base64',
  name: 'file with spaces & special#chars.ts',
  path: 'src/files/file with spaces & special#chars.ts',
  sha: 'special123',
  size: 50
};

/**
 * Mock empty file
 */
export const mockEmptyFileContents: FileContentsResponse = {
  content: '',
  encoding: 'base64',
  name: 'empty.ts',
  path: 'src/empty.ts',
  sha: 'empty000',
  size: 0
};

/**
 * Mock large file content (for performance testing)
 */
export const mockLargeContent = 'x'.repeat(10000);
export const mockLargeFileContents: FileContentsResponse = {
  content: Buffer.from(mockLargeContent).toString('base64'),
  encoding: 'base64',
  name: 'large.ts',
  path: 'src/large.ts',
  sha: 'large123',
  size: mockLargeContent.length
};
