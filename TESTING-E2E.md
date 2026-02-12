# Local E2E Testing Guide

Run the Playwright + VS Code live integration tests locally against a real Forgejo instance.

## Prerequisites

- **Docker** (with Compose v2)
- **Node.js** 18+
- **jq** and **curl**
- **xvfb** (Linux headless only): `sudo apt install xvfb`

## Quick Start

```bash
# First run (~2-3 min: pulls Forgejo image, creates test data, runs tests)
npm run test:e2e:live:local

# Subsequent runs (~30s: reuses running Forgejo, just compiles + tests)
npm run test:e2e:live:local
```

## Flags

```bash
# Run with visible VS Code window (for debugging)
bash scripts/run-e2e-local.sh --headed

# Wipe all data and start fresh
bash scripts/run-e2e-local.sh --clean

# Combine flags
bash scripts/run-e2e-local.sh --clean --headed
```

## What It Does

1. Starts a Forgejo container at `localhost:3000` (via `docker-compose.e2e.yml`)
2. Runs `scripts/setup-forgejo-test.sh` to create test user, repo, branch, PR, and issue
3. Creates a git workspace at `/tmp/forgejo-test-workspace` pointing at the test repo
4. Compiles the extension
5. Runs Playwright against VS Code with the extension loaded

## Manual Step-by-Step

If you prefer to run each step yourself:

```bash
# 1. Start Forgejo
docker compose -f docker-compose.e2e.yml up -d --wait

# 2. Setup test data
export FORGEJO_TEST_URL=http://localhost:3000
bash scripts/setup-forgejo-test.sh
# Note the FORGEJO_TEST_TOKEN=xxx output

# 3. Create test workspace
mkdir -p /tmp/forgejo-test-workspace
cd /tmp/forgejo-test-workspace
git init
git remote add origin http://localhost:3000/testuser/test-repo.git

# 4. Compile
npm run compile

# 5. Run tests
export FORGEJO_TEST_TOKEN=<token from step 2>
export FORGEJO_LIVE_WORKSPACE=/tmp/forgejo-test-workspace
npx playwright test --config playwright.live.config.ts

# With visible window:
npx playwright test --config playwright.live.config.ts --headed
```

## Cleanup

```bash
# Stop Forgejo but keep data (fast restarts)
docker compose -f docker-compose.e2e.yml down

# Stop Forgejo and delete all data
docker compose -f docker-compose.e2e.yml down -v
```

## Troubleshooting

### Port 3000 already in use

```bash
# Check what's using port 3000
lsof -i :3000
# Or stop the existing container
docker compose -f docker-compose.e2e.yml down
```

### Token creation fails on re-run

The setup script deletes and recreates the API token on each run. If you still get token errors, run with `--clean` to wipe all data.

### "No DISPLAY and xvfb-run not found" on Linux

```bash
sudo apt install xvfb
```

### Tests fail with "Extension not activated"

Make sure the extension compiles cleanly:

```bash
npm run compile
```

### Forgejo takes too long to start

The script waits up to 120 seconds. If your machine is slow, the Docker healthcheck and the setup script's wait loop should handle it. If it still fails, try:

```bash
# Start Forgejo separately and wait for it
docker compose -f docker-compose.e2e.yml up -d --wait
curl -sf http://localhost:3000/api/v1/version  # verify it's up
npm run test:e2e:live:local  # then run tests
```

### Forgejo web UI

While the container is running, you can browse to http://localhost:3000 and log in as `testuser` / `testpass123`.
