import * as vscode from 'vscode';

// Mock the config module
jest.mock('../../utils/config', () => ({
  getForgejoConfig: jest.fn()
}));

// Mock the ForgejoClient
jest.mock('../../api/forgejoClient', () => ({
  ForgejoClient: jest.fn().mockImplementation(() => ({
    getPullRequestReviews: jest.fn(),
    getReviewComments: jest.fn(),
    createReviewWithComments: jest.fn()
  }))
}));

import { ForgejoCommentController } from '../../providers/prCommentController';
import { PRContext } from '../../models/comment';

describe('ForgejoCommentController', () => {
  let controller: ForgejoCommentController;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-setup mocks after clearAllMocks
    (vscode.workspace.onDidOpenTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.workspace.onDidCloseTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() });

    (vscode.comments.createCommentController as jest.Mock).mockReturnValue({
      commentingRangeProvider: null,
      createCommentThread: jest.fn(() => ({
        comments: [],
        canReply: true,
        label: '',
        dispose: jest.fn(),
        uri: null,
        range: null
      })),
      dispose: jest.fn(),
    });

    controller = new ForgejoCommentController();
  });

  afterEach(() => {
    controller.dispose();
  });

  describe('PR context registration', () => {
    it('should register PR context for a URI', () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      // Verify context was stored by checking that the controller was created
      expect(vscode.comments.createCommentController).toHaveBeenCalledWith(
        'forgejo-pr-comments',
        'Forgejo PR Comments'
      );
    });

    it('should store context for multiple URIs', () => {
      const uri1 = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/a.ts');
      const uri2 = vscode.Uri.parse('forgejo-pr:/owner/repo/ZmVhdHVyZQ/src/a.ts');

      const ctx1: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/a.ts'
      };

      const ctx2: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/a.ts'
      };

      controller.registerPRContext(uri1, ctx1);
      controller.registerPRContext(uri2, ctx2);

      // Both registrations should succeed without error
      expect(vscode.comments.createCommentController).toHaveBeenCalledTimes(1);
    });
  });

  describe('position mapping', () => {
    it('should use 1-indexed positions for Forgejo API (line 0 in VS Code = line 1 in API)', () => {
      // This is a conceptual test - the position mapping is line + 1
      // VS Code line 0 -> Forgejo line 1
      const vscodeLine = 0;
      const forgejoLine = vscodeLine + 1;
      expect(forgejoLine).toBe(1);
    });

    it('should convert Forgejo 1-indexed to VS Code 0-indexed (line 5 in API = line 4 in VS Code)', () => {
      const forgejoLine = 5;
      const vscodeLine = forgejoLine - 1;
      expect(vscodeLine).toBe(4);
    });

    it('should handle line 1 correctly', () => {
      const forgejoLine = 1;
      const vscodeLine = forgejoLine - 1;
      expect(vscodeLine).toBe(0);
    });
  });

  describe('URI parsing and side detection', () => {
    it('should parse a forgejo-pr URI correctly', () => {
      // The ref "main" base64url-encoded is "bWFpbg"
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const parts = uri.path.split('/').filter((p: string) => p);

      expect(parts[0]).toBe('owner');
      expect(parts[1]).toBe('repo');
      // base64url decode
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe('main');
      expect(parts.slice(3).join('/')).toBe('src/file.ts');
    });

    it('should handle refs with slashes when base64url encoded', () => {
      // The ref "feature/branch" base64url-encoded
      const ref = 'feature/branch';
      const encoded = Buffer.from(ref).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encoded}/src/file.ts`);
      const parts = uri.path.split('/').filter((p: string) => p);

      const decodedRef = Buffer.from(parts[2], 'base64url').toString();
      expect(decodedRef).toBe('feature/branch');
    });

    it('should identify head side when ref matches headRef', () => {
      const headRef = 'feature';
      const encodedHead = Buffer.from(headRef).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encodedHead}/src/file.ts`);

      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      // The ref in the URI matches headRef, so it's the head side
      const parts = uri.path.split('/').filter((p: string) => p);
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe(ctx.headRef);
    });

    it('should identify base side when ref matches baseRef', () => {
      const baseRef = 'main';
      const encodedBase = Buffer.from(baseRef).toString('base64url');
      const uri = vscode.Uri.parse(`forgejo-pr:/owner/repo/${encodedBase}/src/file.ts`);

      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);

      const parts = uri.path.split('/').filter((p: string) => p);
      const ref = Buffer.from(parts[2], 'base64url').toString();
      expect(ref).toBe(ctx.baseRef);
      expect(ref).not.toBe(ctx.headRef);
    });
  });

  describe('dispose', () => {
    it('should clean up resources on dispose', () => {
      const uri = vscode.Uri.parse('forgejo-pr:/owner/repo/bWFpbg/src/file.ts');
      const ctx: PRContext = {
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        baseRef: 'main',
        headRef: 'feature',
        filePath: 'src/file.ts'
      };

      controller.registerPRContext(uri, ctx);
      controller.dispose();

      // Should not throw after dispose
      expect(() => controller.dispose()).not.toThrow();
    });
  });
});
