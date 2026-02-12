#!/usr/bin/env bash
# Setup script for Forgejo live integration tests.
# Creates a test user, API token, repository, branch, PR, and issue
# against a local Forgejo instance.
#
# Required env vars:
#   FORGEJO_TEST_URL  - Base URL of the Forgejo instance (e.g. http://forgejo:3000)
#
# Outputs (written to $GITHUB_ENV if available, otherwise printed):
#   FORGEJO_TEST_TOKEN - API token for the test user

set -euo pipefail

FORGEJO_URL="${FORGEJO_TEST_URL:?FORGEJO_TEST_URL must be set}"

echo "Waiting for Forgejo to be ready at ${FORGEJO_URL}..."
for i in $(seq 1 60); do
  if curl -sf "${FORGEJO_URL}/api/v1/version" >/dev/null 2>&1; then
    echo "Forgejo is ready!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Forgejo did not start within 120 seconds"
    exit 1
  fi
  sleep 2
done

echo "Creating test user..."
# First user registered on a fresh Forgejo instance automatically becomes admin.
# Use the /user/sign_up API endpoint which is available before any users exist.
SIGNUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${FORGEJO_URL}/api/v1/admin/users" \
  -u "forgejo_admin:forgejo_admin" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "testpass123",
    "email": "test@example.com",
    "must_change_password": false,
    "visibility": "public"
  }' 2>/dev/null) || true

HTTP_CODE=$(echo "$SIGNUP_RESPONSE" | tail -1)
if [ "$HTTP_CODE" != "201" ]; then
  echo "Admin API failed (HTTP ${HTTP_CODE}), trying direct registration..."
  # On a fresh instance without admin, register directly (first user becomes admin)
  curl -sf -X POST "${FORGEJO_URL}/user/sign_up" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "user_name=testuser&password=testpass123&retype=testpass123&email=test@example.com" \
    >/dev/null 2>&1 || echo "Registration may already exist, continuing..."
fi

echo "Creating API token..."
TOKEN=$(curl -sf -X POST "${FORGEJO_URL}/api/v1/users/testuser/tokens" \
  -u "testuser:testpass123" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-test-token","scopes":["all"]}' | jq -r '.sha1')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: Failed to create API token"
  exit 1
fi
echo "Token created successfully"

echo "Creating test repository..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/user/repos" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-repo","auto_init":true,"default_branch":"main"}' >/dev/null

echo "Creating feature branch..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/branches" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"new_branch_name":"feature-branch","old_branch_name":"main"}' >/dev/null

echo "Adding test file on feature branch..."
CONTENT=$(echo -n "Hello World" | base64)
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/contents/test.txt" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"add test file\",\"content\":\"${CONTENT}\",\"branch\":\"feature-branch\"}" >/dev/null

echo "Creating pull request..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/pulls" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test PR","body":"This is a test PR","head":"feature-branch","base":"main"}' >/dev/null

echo "Creating issue..."
curl -sf -X POST "${FORGEJO_URL}/api/v1/repos/testuser/test-repo/issues" \
  -H "Authorization: token ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Issue","body":"This is a test issue"}' >/dev/null

echo "Setup complete!"

# Export token for CI
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FORGEJO_TEST_TOKEN=${TOKEN}" >> "$GITHUB_ENV"
  echo "Exported FORGEJO_TEST_TOKEN to GITHUB_ENV"
else
  echo "FORGEJO_TEST_TOKEN=${TOKEN}"
fi
