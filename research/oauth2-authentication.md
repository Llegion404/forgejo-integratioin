# OAuth2 Authentication Research

**Date:** 2026-01-31
**Author:** Research conducted by Claude Sonnet 4.5
**Purpose:** Evaluate OAuth2 implementation to simplify extension installation

## Executive Summary

OAuth2 could significantly improve user experience by replacing manual token generation with browser-based sign-in. However, **Forgejo's OAuth2 scopes are not yet implemented**, meaning OAuth2 tokens currently grant full API access. This creates a security trade-off: better UX vs. less granular permissions.

**Recommendation:** Migrate to SecretStorage now for better security, then implement hybrid OAuth2/token auth when Forgejo scopes are available.

---

## Current Authentication Implementation

### Token Storage
- **Method:** Plain text in VS Code global settings (`forgejo.token`)
- **Location:** `~/.config/Code/User/settings.json` (or OS equivalent)
- **Security:** ⚠️ Unencrypted, visible in settings UI
- **Access:** `vscode.workspace.getConfiguration('forgejo').get<string>('token')`

### Configuration Flow
1. User runs `forgejo.setAuthToken` command
2. Enters token in masked input box
3. Token saved to settings via `config.update()`
4. ForgejoClient uses token in `Authorization: token <TOKEN>` header

### Code Locations
- Token storage: `src/utils/config.ts` (lines 81-84)
- API usage: `src/api/forgejoClient.ts` (lines 16-45)
- Setup command: `src/extension.ts` (lines 78-100)

---

## OAuth2 in VS Code Extensions

### VS Code Authentication API

VS Code provides a robust `AuthenticationProvider` interface with four required methods:

```typescript
interface AuthenticationProvider {
  getSessions(scopes?: string[]): Promise<AuthenticationSession[]>;
  createSession(scopes: string[]): Promise<AuthenticationSession>;
  removeSession(sessionId: string): Promise<void>;
  onDidChangeSessions: Event<AuthenticationSessionsChangeEvent>;
}
```

### Registration

**package.json:**
```json
{
  "contributes": {
    "authentication": [
      {
        "id": "forgejo",
        "label": "Forgejo"
      }
    ]
  }
}
```

**extension.ts:**
```typescript
vscode.authentication.registerAuthenticationProvider(
  'forgejo',
  'Forgejo',
  provider
);
```

### OAuth2 Flow (Authorization Code + PKCE)

OAuth 2.1 mandates PKCE for all clients, including VS Code extensions:

1. **Generate PKCE Challenge:**
   ```typescript
   const codeVerifier = crypto.randomBytes(32).toString('base64url');
   const codeChallenge = crypto.createHash('sha256')
     .update(codeVerifier)
     .digest('base64url');
   ```

2. **Authorization Request:**
   ```
   GET /login/oauth/authorize?
     client_id=CLIENT_ID&
     redirect_uri=vscode://publisher.extension/callback&
     response_type=code&
     code_challenge=CHALLENGE&
     code_challenge_method=S256
   ```

3. **Callback Handling:**
   ```typescript
   vscode.window.registerUriHandler({
     handleUri(uri: vscode.Uri) {
       const code = uri.query.get('code');
       // Exchange code + verifier for access token
     }
   });
   ```

4. **Token Exchange:**
   ```
   POST /login/oauth/access_token
   {
     "client_id": "CLIENT_ID",
     "code": "AUTH_CODE",
     "code_verifier": "VERIFIER",
     "grant_type": "authorization_code",
     "redirect_uri": "REDIRECT_URI"
   }
   ```

### SecretStorage API

VS Code's `SecretStorage` provides encrypted token storage:

```typescript
// Store
await context.secrets.store('forgejo.token', accessToken);

// Retrieve
const token = await context.secrets.get('forgejo.token');

// Delete
await context.secrets.delete('forgejo.token');
```

**Platform-Specific Storage:**
- macOS: Keychain Access
- Windows: Credential Manager
- Linux: Secret Service API (GNOME Keyring, KWallet)

**Security Note:** More secure than plain text, but not impenetrable. Other extensions with keyring access could potentially read secrets.

### UX Improvements

**Current Flow:**
```
1. Open Forgejo Settings → Applications
2. Click "Generate New Token"
3. Set scopes and name
4. Copy token (shown once)
5. Open VS Code Settings
6. Find forgejo.token setting
7. Paste token
```

**OAuth2 Flow:**
```
1. Click "Sign in with Forgejo" in Accounts menu
2. Browser opens, user authorizes
3. Done - token stored securely
```

---

## Forgejo OAuth2 Support

### Capabilities

✅ **Supported:**
- Authorization Code Grant with PKCE
- Public clients (no client secret required)
- OpenID Connect (OIDC)
- Multiple redirect URIs per application

❌ **Not Supported:**
- Device Flow (for headless environments)
- OAuth2 scopes (in development)

### Endpoints

| Endpoint | URL |
|----------|-----|
| OpenID Discovery | `/.well-known/openid-configuration` |
| Authorization | `/login/oauth/authorize` |
| Access Token | `/login/oauth/access_token` |
| UserInfo | `/login/oauth/userinfo` |
| JWKS | `/login/oauth/keys` |

### Token Usage

Forgejo accepts tokens via:
- Header: `Authorization: Bearer <TOKEN>` (OAuth2 standard)
- Header: `Authorization: token <TOKEN>` (PAT format, also works)
- Query: `?token=<TOKEN>` or `?access_token=<TOKEN>`

### Application Registration

**User-level:** `https://instance.com/user/settings/applications`
**Instance-wide (admin):** `https://instance.com/admin/applications`

**API Registration:**
```bash
curl -X POST https://instance.com/api/v1/users/username/tokens \
  -u username:password \
  -H "Content-Type: application/json" \
  -d '{"name": "token-name", "scopes": ["read:repository"]}'
```

### Critical Limitation: No OAuth2 Scopes

⚠️ **From Official Docs:**
> "Third-party applications obtaining a token for a user via such an application will have administrative rights. OAuth2 scopes are not yet implemented."

**Current Status:**
- OAuth2 tokens grant **FULL ACCESS** (equivalent to admin rights)
- Personal Access Tokens (PATs) **DO have scopes** implemented
- In active development: PRs [#6197](https://codeberg.org/forgejo/forgejo/pulls/6197) and [#4449](https://codeberg.org/forgejo/forgejo/pulls/4449)

**Planned Scopes (when implemented):**
- `read:repository` / `write:repository`
- `read:user` / `write:user`
- `read:issue` / `write:issue`
- `read:package` / `write:package`
- Plus: organizations, notifications, admin, activitypub

**Workaround:** Use scoped PATs instead of OAuth2 for security-sensitive environments.

---

## Implementation Options

### Option 1: Hybrid OAuth2 + PAT (Recommended Post-Scopes)

Support both authentication methods:

```typescript
async function getAuthToken(): Promise<string | null> {
  // Try OAuth2 session first
  const session = await vscode.authentication.getSession(
    'forgejo',
    ['read:repository'],
    { createIfNone: false }
  );

  if (session) {
    return session.accessToken;
  }

  // Fallback to manual PAT
  const manualToken = await context.secrets.get('forgejo.token');
  if (manualToken) {
    return manualToken;
  }

  // Prompt user to choose
  const choice = await vscode.window.showQuickPick([
    { label: 'Sign in with OAuth2', value: 'oauth' },
    { label: 'Use Personal Access Token', value: 'pat' }
  ]);

  if (choice?.value === 'oauth') {
    const newSession = await vscode.authentication.getSession(
      'forgejo',
      ['read:repository'],
      { createIfNone: true }
    );
    return newSession.accessToken;
  } else {
    return await promptForManualToken();
  }
}
```

**Pros:**
- Best UX for casual users (OAuth2)
- Security for power users (scoped PATs)
- Encrypted storage (SecretStorage)

**Cons:**
- More complex implementation
- Two auth paths to maintain

### Option 2: SecretStorage Migration (Immediate Priority)

Improve current approach without OAuth2:

```typescript
// src/utils/config.ts
export async function setAuthToken(
  context: vscode.ExtensionContext,
  token: string
): Promise<void> {
  // Store in SecretStorage instead of settings
  await context.secrets.store('forgejo.token', token);

  // Remove from settings if present (migration)
  const config = vscode.workspace.getConfiguration('forgejo');
  if (config.get('token')) {
    await config.update('token', undefined, vscode.ConfigurationTarget.Global);
  }
}

export async function getAuthToken(
  context: vscode.ExtensionContext
): Promise<string | null> {
  // Try SecretStorage first
  let token = await context.secrets.get('forgejo.token');

  // Migrate from settings if needed
  if (!token) {
    const config = vscode.workspace.getConfiguration('forgejo');
    const settingsToken = config.get<string>('token');
    if (settingsToken) {
      await setAuthToken(context, settingsToken);
      token = settingsToken;
    }
  }

  return token || null;
}
```

**Setup Wizard:**
```typescript
vscode.commands.registerCommand('forgejo.setupWizard', async () => {
  const config = await getForgejoConfig();
  if (!config) {
    vscode.window.showErrorMessage('No Forgejo repository detected');
    return;
  }

  // Open browser to token creation page
  const tokenUrl = `${config.instanceUrl}/user/settings/applications`;
  await vscode.env.openExternal(vscode.Uri.parse(tokenUrl));

  // Show instructions
  const token = await vscode.window.showInputBox({
    prompt: 'Paste your Forgejo personal access token',
    placeHolder: 'token_xxxxxxxxxxxxxx',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) return 'Token is required';
      if (value.length < 20) return 'Token seems too short';
      return null;
    }
  });

  if (token) {
    await setAuthToken(context, token);
    vscode.window.showInformationMessage('✓ Forgejo token saved securely');
    // Refresh views
  }
});
```

**Pros:**
- Immediate security improvement
- Works with scoped tokens
- No dependency on Forgejo OAuth2 scopes
- Simpler implementation

**Cons:**
- Still requires manual token generation
- Not as smooth as OAuth2 UX

### Option 3: Wait for Forgejo Scopes

Delay OAuth2 implementation until scopes are available.

**Pros:**
- Secure from day one
- Avoid full-access tokens

**Cons:**
- Timeline uncertain (PRs in review)
- Manual setup remains

---

## Recommended Implementation Plan

### Phase 1: Immediate (Now)
**Migrate to SecretStorage**

1. Update `src/utils/config.ts`:
   - Change signature to accept `ExtensionContext`
   - Use `context.secrets` instead of settings
   - Add migration logic for existing tokens

2. Update all callers:
   - `src/extension.ts` commands
   - `src/providers/*.ts` tree providers

3. Add setup wizard:
   - Open browser to token creation page
   - Guide user through scopes selection
   - Validate and store token

4. Update tests:
   - Mock `ExtensionContext.secrets`
   - Test migration path

**Estimated Effort:** 2-3 hours
**Security Impact:** High (encrypted storage)
**UX Impact:** Medium (better onboarding)

### Phase 2: Monitor Forgejo Development

Watch these PRs:
- [#6197 - Refactor OAuth2 Scopes](https://codeberg.org/forgejo/forgejo/pulls/6197)
- [#4449 - Enhance OAuth2 Provider Scopes](https://codeberg.org/forgejo/forgejo/pulls/4449)

### Phase 3: OAuth2 Implementation (When Scopes Available)

1. Create authentication provider:
   - `src/auth/forgejoAuthProvider.ts`
   - `src/auth/pkce.ts` (PKCE utilities)
   - `src/auth/uriHandler.ts` (callback handler)

2. Register provider:
   - Update `package.json` contributions
   - Register in `extension.ts` activation

3. Implement hybrid flow:
   - Try OAuth2 session first
   - Fallback to PAT
   - Let users choose method

4. Add comprehensive tests:
   - PKCE generation
   - Session management
   - Token refresh
   - Error handling

**Estimated Effort:** 1-2 weeks
**Security Impact:** High (depends on Forgejo scopes)
**UX Impact:** Very High (seamless sign-in)

---

## Testing Strategy

### Unit Tests

**SecretStorage Migration:**
```typescript
test('migrates token from settings to secrets', async () => {
  const mockContext = createMockContext({
    settings: { 'forgejo.token': 'old-token' }
  });

  const token = await getAuthToken(mockContext);

  expect(token).toBe('old-token');
  expect(mockContext.secrets.store).toHaveBeenCalledWith(
    'forgejo.token',
    'old-token'
  );
  expect(mockContext.workspaceConfiguration.update).toHaveBeenCalledWith(
    'token',
    undefined,
    vscode.ConfigurationTarget.Global
  );
});
```

**OAuth2 Provider:**
```typescript
test('generates valid PKCE challenge', () => {
  const { verifier, challenge } = generatePKCE();

  expect(verifier).toHaveLength(43); // Base64URL of 32 bytes
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Verify challenge is SHA256 of verifier
  const expected = crypto.createHash('sha256')
    .update(verifier)
    .digest('base64url');
  expect(challenge).toBe(expected);
});
```

### Integration Tests

**Setup Wizard:**
```typescript
test('setup wizard opens browser and stores token', async () => {
  const openExternal = sinon.stub(vscode.env, 'openExternal');
  const showInputBox = sinon.stub(vscode.window, 'showInputBox')
    .resolves('test-token-123');

  await vscode.commands.executeCommand('forgejo.setupWizard');

  expect(openExternal).toHaveBeenCalledWith(
    sinon.match.has('path', '/user/settings/applications')
  );
  expect(await context.secrets.get('forgejo.token')).toBe('test-token-123');
});
```

**OAuth2 Flow:**
```typescript
test('creates OAuth2 session and uses token', async () => {
  const session = await vscode.authentication.getSession(
    'forgejo',
    ['read:repository'],
    { createIfNone: true }
  );

  expect(session.accessToken).toBeDefined();
  expect(session.scopes).toContain('read:repository');

  // Verify token works with API
  const client = new ForgejoClient(instanceUrl, session.accessToken);
  const prs = await client.getPullRequests('owner', 'repo');
  expect(prs).toBeDefined();
});
```

---

## Security Considerations

### Current Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Plain text token storage | High | ✅ Migrate to SecretStorage |
| No token validation | Medium | Add connection test on save |
| No expiration handling | Low | Tokens don't expire by default |
| Settings sync exposure | High | SecretStorage not synced |

### OAuth2 Risks (if implemented now)

| Risk | Severity | Notes |
|------|----------|-------|
| Full access tokens | **Critical** | No scopes = admin rights |
| Token theft | Medium | PKCE mitigates auth code interception |
| Malicious redirect | Low | State parameter prevents CSRF |

### Best Practices

✅ **Do:**
- Use PKCE for OAuth2 (no client secret)
- Store tokens in SecretStorage
- Validate instance URL before auth
- Implement state parameter for CSRF protection
- Clear tokens on sign-out

❌ **Don't:**
- Hardcode client secrets
- Use Implicit Flow (deprecated)
- Store tokens in settings or localStorage
- Skip token validation
- Log tokens in console

---

## Alternative Approaches

### 1. Device Flow (Future)

If Forgejo adds Device Flow support, ideal for:
- Headless environments
- SSH/remote development
- CI/CD contexts

**Flow:**
```
1. Extension requests device code
2. Show user code + verification URL
3. User enters code in browser
4. Extension polls for token
```

**Benefit:** No callback URI needed, works in restricted environments.

### 2. GitHub Codespaces / Gitpod

For remote development:
- Use proxy service for OAuth callback
- Preserve query parameters from `asExternalUri()`
- Test in Codespaces environment

**Example:**
```typescript
const redirectUri = await vscode.env.asExternalUri(
  vscode.Uri.parse(`${vscode.env.uriScheme}://publisher.extension/callback`)
);
// redirectUri preserves proxy parameters automatically
```

### 3. Instance-Specific Providers

For organizations with multiple Forgejo instances:
- Register separate auth provider per instance
- Use instance URL as provider ID
- Allow switching between accounts

**Challenge:** VS Code limits to one provider per ID.

---

## References

### Official Documentation

- [VS Code Authentication API](https://code.visualstudio.com/api/references/vscode-api#authentication)
- [Forgejo OAuth2 Provider](https://forgejo.org/docs/next/user/oauth2-provider/)
- [Forgejo API Usage](https://forgejo.org/docs/next/user/api-usage/)
- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)

### Tutorials & Examples

- [Create Authentication Provider for VS Code (Elio Struyf)](https://www.eliostruyf.com/create-authentication-provider-visual-studio-code/)
- [Microsoft Authentication Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/authenticationprovider-sample)
- [GitHub Authentication Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/github-authentication-sample)

### Security Research

- [VS Code SecretStorage Security (Cycode)](https://cycode.com/blog/exposing-vscode-secrets/)
- [OAuth 2.1 Features for 2026 (Medium)](https://rgutierrez2004.medium.com/oauth-2-1-features-you-cant-ignore-in-2026-a15f852cb723)

### Forgejo Development

- [PR #6197 - Refactor OAuth2 Scopes](https://codeberg.org/forgejo/forgejo/pulls/6197)
- [PR #4449 - Enhance OAuth2 Provider Scopes](https://codeberg.org/forgejo/forgejo/pulls/4449)
- [PR #3307 - PKCE Implementation](https://codeberg.org/forgejo/forgejo/pulls/3307)

### Related Projects

- [GitLab Workflow Extension](https://docs.gitlab.com/editor_extensions/visual_studio_code/setup/)
- [GitHub Pull Requests Extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)

---

## Conclusion

OAuth2 would provide a significantly better installation experience, but **waiting for Forgejo's scope implementation is prudent** to avoid security issues with full-access tokens.

**Immediate Action:** Migrate to SecretStorage and add setup wizard for immediate security and UX improvements.

**Future Action:** Implement hybrid OAuth2/PAT authentication when Forgejo OAuth2 scopes are released.

This approach balances user experience, security, and development effort while avoiding premature optimization.

---

**Document Version:** 1.0
**Last Updated:** 2026-01-31
**Next Review:** When Forgejo OAuth2 scope PRs merge
