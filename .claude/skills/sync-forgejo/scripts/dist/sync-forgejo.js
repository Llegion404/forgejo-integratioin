#!/usr/bin/env node

// src/sync-forgejo.ts
import { execSync, spawnSync } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// node_modules/forgejo-ts/dist/esm/errors.js
var ForgejoError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ForgejoError";
  }
};
var ForgejoApiError = class extends ForgejoError {
  statusCode;
  statusText;
  responseBody;
  constructor(statusCode, statusText, responseBody) {
    super(`HTTP ${statusCode}: ${statusText}${responseBody ? ` - ${responseBody}` : ""}`);
    this.name = "ForgejoApiError";
    this.statusCode = statusCode;
    this.statusText = statusText;
    this.responseBody = responseBody;
  }
};
var ForgejoNetworkError = class extends ForgejoError {
  url;
  cause;
  constructor(url, cause) {
    const message = cause ? `Network error: Cannot reach ${url}. ${cause.message}` : `Network error: Cannot reach ${url}`;
    super(message);
    this.name = "ForgejoNetworkError";
    this.url = url;
    this.cause = cause;
  }
};

// node_modules/forgejo-ts/dist/esm/logger.js
var noopLogger = {
  debug() {
  },
  info() {
  },
  warn() {
  },
  error() {
  }
};

// node_modules/forgejo-ts/dist/esm/client.js
var ForgejoClient = class {
  instanceUrl;
  token;
  logger;
  timeout;
  constructor(options) {
    this.instanceUrl = options.instanceUrl.replace(/\/+$/, "");
    this.token = options.token ?? "";
    this.logger = options.logger ?? noopLogger;
    this.timeout = options.timeout ?? 3e4;
  }
  // ======================== Internal helpers ========================
  buildHeaders(contentType = "application/json") {
    const headers = {
      "Accept": "application/json",
      "Content-Type": contentType
    };
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }
    return headers;
  }
  async request(endpoint) {
    const url = `${this.instanceUrl}/api/v1${endpoint}`;
    this.logger.debug("GET", url);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeout)
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ForgejoApiError(response.status, response.statusText, body);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ForgejoApiError)
        throw error;
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new ForgejoNetworkError(url, error);
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ForgejoNetworkError(url, error);
      }
      if (error instanceof Error) {
        throw new ForgejoNetworkError(url, error);
      }
      throw error;
    }
  }
  async requestAllPages(endpoint, limit = 50) {
    const allItems = [];
    let page = 1;
    for (; ; ) {
      const sep = endpoint.includes("?") ? "&" : "?";
      const items = await this.request(`${endpoint}${sep}page=${page}&limit=${limit}`);
      allItems.push(...items);
      if (items.length < limit)
        break;
      page++;
    }
    return allItems;
  }
  async requestWithBody(method, endpoint, body) {
    const url = `${this.instanceUrl}/api/v1${endpoint}`;
    this.logger.debug(`${method} ${url}`);
    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: body !== void 0 ? JSON.stringify(body) : void 0,
        signal: AbortSignal.timeout(this.timeout)
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new ForgejoApiError(response.status, response.statusText, errorBody);
      }
      const contentType = response.headers?.get?.("content-type") ?? "";
      if (response.status === 204 || !contentType) {
        try {
          return await response.json();
        } catch {
          return void 0;
        }
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ForgejoApiError)
        throw error;
      if (error instanceof Error) {
        throw new ForgejoNetworkError(url, error);
      }
      throw error;
    }
  }
  /**
   * Make a raw web request (not going through /api/v1).
   * Used for web-scraping endpoints like workflow logs.
   */
  async webRequest(url) {
    const headers = {};
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }
    this.logger.debug("WEB GET", url);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeout)
      });
      if (!response.ok) {
        throw new ForgejoApiError(response.status, response.statusText, "");
      }
      return await response.text();
    } catch (error) {
      if (error instanceof ForgejoApiError)
        throw error;
      if (error instanceof Error) {
        throw new ForgejoNetworkError(url, error);
      }
      throw error;
    }
  }
  // ======================== Connection ========================
  async testConnection() {
    this.logger.info("Testing connection to", this.instanceUrl);
    try {
      await this.request("/version");
      this.logger.info("Connection test SUCCESS");
      return true;
    } catch (error) {
      this.logger.error("Connection test FAILED:", error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  // ======================== Pull Requests ========================
  async listPullRequests(owner, repo, state = "all") {
    return this.requestAllPages(`/repos/${owner}/${repo}/pulls?state=${state}`);
  }
  async getPullRequest(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}`);
  }
  async createPullRequest(owner, repo, title, head, base, body) {
    const payload = { title, head, base };
    if (body)
      payload.body = body;
    try {
      return await this.requestWithBody("POST", `/repos/${owner}/${repo}/pulls`, payload);
    } catch (error) {
      if (error instanceof ForgejoApiError) {
        if (error.statusCode === 409) {
          throw new ForgejoApiError(409, "Conflict", "A pull request already exists for this branch");
        }
        if (error.statusCode === 422) {
          throw new ForgejoApiError(422, "Unprocessable Entity", error.responseBody);
        }
      }
      throw error;
    }
  }
  async updatePullRequest(owner, repo, number, updates) {
    return this.requestWithBody("PATCH", `/repos/${owner}/${repo}/pulls/${number}`, updates);
  }
  async mergePullRequest(owner, repo, number, method = "merge", deleteBranchAfterMerge = false) {
    try {
      await this.requestWithBody("POST", `/repos/${owner}/${repo}/pulls/${number}/merge`, {
        Do: method,
        delete_branch_after_merge: deleteBranchAfterMerge
      });
    } catch (error) {
      if (error instanceof ForgejoApiError) {
        if (error.statusCode === 405) {
          throw new ForgejoApiError(405, "Not Allowed", "Merge not allowed - PR may not be mergeable");
        }
        if (error.statusCode === 409) {
          throw new ForgejoApiError(409, "Conflict", "Merge conflict - PR has conflicts that must be resolved");
        }
      }
      throw error;
    }
  }
  async closePullRequest(owner, repo, number) {
    return this.requestWithBody("PATCH", `/repos/${owner}/${repo}/pulls/${number}`, { state: "closed" });
  }
  async getPullRequestFiles(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/files`);
  }
  async getPullRequestRefs(owner, repo, number) {
    const pr = await this.getPullRequest(owner, repo, number);
    return { base: pr.base.ref, head: pr.head.ref };
  }
  async getPullRequestReviews(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/reviews`);
  }
  async getPullRequestCommits(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/commits`);
  }
  // ======================== Reviews ========================
  async getReviewComments(owner, repo, prNumber, reviewId) {
    return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/comments`);
  }
  async createReview(owner, repo, number, state, body) {
    return this.requestWithBody("POST", `/repos/${owner}/${repo}/pulls/${number}/reviews`, { event: state, body });
  }
  async createReviewWithComments(owner, repo, prNumber, options) {
    return this.requestWithBody("POST", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`, options);
  }
  // ======================== Issues ========================
  async listIssues(owner, repo, state = "all") {
    const items = await this.requestAllPages(`/repos/${owner}/${repo}/issues?state=${state}`);
    return items.filter((item) => !item.pull_request);
  }
  async getIssue(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}`);
  }
  async createIssue(owner, repo, title, body) {
    const payload = { title };
    if (body)
      payload.body = body;
    return this.requestWithBody("POST", `/repos/${owner}/${repo}/issues`, payload);
  }
  async updateIssue(owner, repo, number, updates) {
    return this.requestWithBody("PATCH", `/repos/${owner}/${repo}/issues/${number}`, updates);
  }
  async getIssueComments(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}/comments`);
  }
  async createComment(owner, repo, number, body) {
    return this.requestWithBody("POST", `/repos/${owner}/${repo}/issues/${number}/comments`, { body });
  }
  async getIssueTimeline(owner, repo, number) {
    return this.request(`/repos/${owner}/${repo}/issues/${number}/timeline`);
  }
  // ======================== Files ========================
  async getFileContents(owner, repo, filepath, ref) {
    const encodedPath = filepath.split("/").map(encodeURIComponent).join("/");
    const endpoint = `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    const response = await this.request(endpoint);
    if (response.encoding === "base64") {
      return Buffer.from(response.content, "base64").toString("utf-8");
    }
    return response.content;
  }
  // ======================== CI / Actions ========================
  async listWorkflowRuns(owner, repo, options) {
    let endpoint = `/repos/${owner}/${repo}/actions/tasks`;
    const params = [];
    if (options?.status)
      params.push(`status=${options.status}`);
    if (options?.branch)
      params.push(`branch=${options.branch}`);
    if (params.length)
      endpoint += "?" + params.join("&");
    const limit = 50;
    const allRuns = [];
    let page = 1;
    for (; ; ) {
      const sep = endpoint.includes("?") ? "&" : "?";
      const response = await this.request(`${endpoint}${sep}page=${page}&limit=${limit}`);
      allRuns.push(...response.workflow_runs);
      if (response.workflow_runs.length < limit)
        break;
      page++;
    }
    return { total_count: allRuns.length, workflow_runs: allRuns };
  }
  async getWorkflowRun(owner, repo, runId) {
    return this.request(`/repos/${owner}/${repo}/actions/runs/${runId}`);
  }
  async getWorkflowJobs(owner, repo, runId) {
    return this.request(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);
  }
  async getWorkflowLogs(owner, repo, runNumber, jobIndex = 0) {
    const url = `${this.instanceUrl}/${owner}/${repo}/actions/runs/${runNumber}/jobs/${jobIndex}/logs`;
    return this.webRequest(url);
  }
  async getJobSteps(owner, repo, runNumber, jobIndex = 0) {
    const url = `${this.instanceUrl}/${owner}/${repo}/actions/runs/${runNumber}/jobs/${jobIndex}`;
    const html = await this.webRequest(url);
    const match = html.match(/data-initial-post-response="([^"]*)"/);
    if (!match)
      return [];
    const jsonStr = match[1].replace(/&#34;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const data = JSON.parse(jsonStr);
    const steps = data.state?.currentJob?.steps;
    if (!Array.isArray(steps))
      return [];
    return steps.map((s) => ({
      summary: s.summary ?? "Unknown step",
      duration: s.duration ?? "",
      status: s.status ?? "unknown"
    }));
  }
  async rerunWorkflow(owner, repo, runId) {
    await this.requestWithBody("POST", `/repos/${owner}/${repo}/actions/runs/${runId}/rerun`);
  }
  async getCommitStatuses(owner, repo, sha) {
    return this.request(`/repos/${owner}/${repo}/statuses/${sha}`);
  }
  // ======================== Tags ========================
  async listTags(owner, repo) {
    return this.requestAllPages(`/repos/${owner}/${repo}/tags`);
  }
  async createTag(owner, repo, options) {
    return this.requestWithBody("POST", `/repos/${owner}/${repo}/tags`, options);
  }
  async deleteTag(owner, repo, tagName) {
    await this.requestWithBody("DELETE", `/repos/${owner}/${repo}/tags/${encodeURIComponent(tagName)}`);
  }
  // ======================== Releases ========================
  async listReleases(owner, repo) {
    return this.requestAllPages(`/repos/${owner}/${repo}/releases`);
  }
  async createRelease(owner, repo, options) {
    return this.requestWithBody("POST", `/repos/${owner}/${repo}/releases`, options);
  }
  async getRelease(owner, repo, id) {
    return this.request(`/repos/${owner}/${repo}/releases/${id}`);
  }
  async getReleaseByTag(owner, repo, tag) {
    return this.request(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  }
  async deleteRelease(owner, repo, id) {
    await this.requestWithBody("DELETE", `/repos/${owner}/${repo}/releases/${id}`);
  }
  // ======================== Raw API ========================
  /**
   * Escape hatch for any Forgejo API endpoint not covered by typed methods.
   * @param method HTTP method
   * @param endpoint API path (e.g. "/repos/owner/repo/topics")
   * @param body Optional request body
   */
  async rawRequest(method, endpoint, body) {
    if (method.toUpperCase() === "GET") {
      return this.request(endpoint);
    }
    return this.requestWithBody(method.toUpperCase(), endpoint, body);
  }
};

// src/sync-forgejo.ts
function detectRemote() {
  let url;
  try {
    url = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
  } catch {
    console.error("ERROR: Could not get git remote URL. Are you in a git repo?");
    process.exit(1);
  }
  let m = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (m)
    return [m[1], m[2], m[3]];
  m = url.match(/^ssh:\/\/(?:git@)?([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (m)
    return [m[1], m[2], m[3]];
  m = url.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (m)
    return [m[1], m[2], m[3]];
  console.error(`ERROR: Could not parse git remote URL: ${url}`);
  process.exit(1);
}
function loadToken(host) {
  const envToken = process.env.FORGEJO_TOKEN;
  if (envToken)
    return envToken;
  const configPaths = [
    path.join(os.homedir(), ".config", "forgejo-claude", "config.json"),
    path.join(os.homedir(), ".forgejo-claude.json")
  ];
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const instance = data.instances?.[host];
        if (instance?.token)
          return instance.token;
      } catch {
      }
    }
  }
  return "";
}
function bdExport() {
  const result = spawnSync("bd", ["export"], { encoding: "utf-8" });
  if (result.status !== 0) {
    console.error(`  WARNING: bd export failed: ${result.stderr}`);
    return [];
  }
  const items = [];
  for (const line of result.stdout.trim().split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        items.push(JSON.parse(trimmed));
      } catch {
      }
    }
  }
  return items;
}
function bdRun(args) {
  const result = spawnSync("bd", args, { encoding: "utf-8" });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim()
  };
}
async function fetchForgejoIssues(client, owner, repo) {
  const issues = [];
  for (const state of ["open", "closed"]) {
    let page = 1;
    while (true) {
      let data;
      try {
        data = await client.rawRequest(
          "GET",
          `/repos/${owner}/${repo}/issues?state=${state}&type=issues&limit=50&page=${page}`
        );
      } catch (e) {
        if (e instanceof ForgejoApiError) {
          console.error(`  WARNING: GET issues failed: HTTP ${e.statusCode}`);
        }
        break;
      }
      const batch = data.filter((i) => !i.pull_request);
      issues.push(...batch);
      if (data.length < 50)
        break;
      page++;
    }
  }
  return issues;
}
var EXTERNAL_REF_RE = /^forgejo-(\d+)$/;
var NOTES_URL_RE = /\/issues\/(\d+)/;
function parseForgejoNumberFromRef(ref) {
  if (!ref)
    return null;
  const m = ref.match(EXTERNAL_REF_RE);
  return m ? parseInt(m[1]) : null;
}
function parseForgejoNumberFromNotes(notes) {
  if (!notes)
    return null;
  const m = notes.match(NOTES_URL_RE);
  return m ? parseInt(m[1]) : null;
}
function inferType(title) {
  const lower = title.toLowerCase();
  if (lower.startsWith("bug:") || lower.startsWith("bug ") || lower.split(/\s+/).slice(0, 2).includes("bug")) {
    return "bug";
  }
  if (lower.startsWith("feat:") || lower.startsWith("feat ") || lower.startsWith("feature:")) {
    return "feature";
  }
  return "task";
}
function beadsStatusToForgejo(status) {
  if (["open", "in_progress", "blocked"].includes(status))
    return "open";
  return "closed";
}
function parseIso(ts) {
  if (!ts)
    return null;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function buildSyncPlan(forgejoIssues, beadsIssues, host, owner, repo) {
  const fgByNum = /* @__PURE__ */ new Map();
  for (const i of forgejoIssues)
    fgByNum.set(i.number, i);
  const bdByFgNum = /* @__PURE__ */ new Map();
  const bdUnlinked = [];
  for (const b of beadsIssues) {
    let fgNum = parseForgejoNumberFromRef(b.external_ref);
    if (fgNum === null)
      fgNum = parseForgejoNumberFromNotes(b.notes);
    if (fgNum !== null) {
      bdByFgNum.set(fgNum, b);
    } else {
      bdUnlinked.push(b);
    }
  }
  const actions = [];
  for (const [num, fg] of fgByNum) {
    if (!bdByFgNum.has(num)) {
      actions.push({
        action: "import",
        forgejo: fg,
        beads: null,
        detail: `Import Forgejo #${num}: ${fg.title}`
      });
    }
  }
  for (const [num, bd] of bdByFgNum) {
    const fg = fgByNum.get(num);
    if (!fg)
      continue;
    const bdState = beadsStatusToForgejo(bd.status || "open");
    const fgState = fg.state || "open";
    if (bdState !== fgState) {
      const bdTs = parseIso(bd.updated_at);
      const fgTs = parseIso(fg.updated_at);
      let direction;
      let targetState;
      if (bdTs && fgTs && bdTs > fgTs) {
        direction = "beads\u2192forgejo";
        targetState = bdState;
      } else {
        direction = "forgejo\u2192beads";
        targetState = fgState;
      }
      actions.push({
        action: "sync_status",
        forgejo: fg,
        beads: bd,
        detail: `Sync #${num} status: ${direction} \u2192 ${targetState}`,
        direction,
        target_state: targetState
      });
    }
  }
  for (const bd of bdUnlinked) {
    actions.push({
      action: "export",
      forgejo: null,
      beads: bd,
      detail: `Export beads ${bd.id}: ${bd.title}`
    });
  }
  return actions;
}
async function executeActions(actions, client, host, owner, repo, token, dryRun) {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const act of actions) {
    console.log(`
  ${dryRun ? "[DRY RUN] " : ""}\xBB ${act.detail}`);
    if (dryRun) {
      skipped++;
      continue;
    }
    if (act.action === "import") {
      if (await doImport(act.forgejo, host, owner, repo)) {
        succeeded++;
      } else {
        failed++;
      }
    } else if (act.action === "export") {
      if (!token) {
        console.log("    SKIP: No token available, cannot create Forgejo issues");
        skipped++;
        continue;
      }
      if (await doExport(act.beads, client, host, owner, repo)) {
        succeeded++;
      } else {
        failed++;
      }
    } else if (act.action === "sync_status") {
      const direction = act.direction || "forgejo\u2192beads";
      const target = act.target_state || "open";
      if (direction === "forgejo\u2192beads") {
        if (doSyncToBeads(act.beads, target)) {
          succeeded++;
        } else {
          failed++;
        }
      } else {
        if (!token) {
          console.log("    SKIP: No token available, cannot update Forgejo");
          skipped++;
          continue;
        }
        if (await doSyncToForgejo(act.forgejo, target, client, owner, repo)) {
          succeeded++;
        } else {
          failed++;
        }
      }
    }
  }
  return [succeeded, failed, skipped];
}
async function doImport(fg, host, owner, repo) {
  const num = fg.number;
  const title = fg.title;
  const body = fg.body || "";
  const fgUrl = `https://${host}/${owner}/${repo}/issues/${num}`;
  const issueType = inferType(title);
  const fgState = fg.state || "open";
  const desc = body.length > 2e3 ? body.slice(0, 2e3) : body || title;
  const { ok, stdout, stderr } = bdRun([
    "create",
    `--title=${title}`,
    `--type=${issueType}`,
    `--external-ref=forgejo-${num}`,
    `--notes=Forgejo: ${fgUrl}`,
    `--description=${desc}`,
    "--silent"
  ]);
  if (!ok) {
    console.log(`    FAILED: bd create: ${stderr}`);
    return false;
  }
  const beadId = stdout.trim().split("\n").pop()?.trim() || null;
  console.log(`    Created beads issue: ${beadId}`);
  if (fgState === "closed" && beadId) {
    const r = bdRun(["close", beadId, "--reason=Closed on Forgejo"]);
    if (r.ok) {
      console.log(`    Closed ${beadId} (matches Forgejo state)`);
    } else {
      console.log(`    WARNING: Could not close ${beadId}: ${r.stderr}`);
    }
  }
  return true;
}
async function doExport(bd, client, host, owner, repo) {
  const beadId = bd.id;
  const title = bd.title;
  const desc = bd.description || "";
  const bdStatus = bd.status || "open";
  let body = desc;
  if (body)
    body += "\n\n";
  body += `_Synced from beads issue \`${beadId}\`_`;
  let result;
  try {
    result = await client.rawRequest(
      "POST",
      `/repos/${owner}/${repo}/issues`,
      { title, body }
    );
  } catch (e) {
    console.log(`    FAILED: Could not create Forgejo issue for ${beadId}`);
    return false;
  }
  if (!result) {
    console.log(`    FAILED: Could not create Forgejo issue for ${beadId}`);
    return false;
  }
  const fgNum = result.number;
  const fgUrl = `https://${host}/${owner}/${repo}/issues/${fgNum}`;
  console.log(`    Created Forgejo #${fgNum}: ${fgUrl}`);
  const r = bdRun(["update", beadId, `--external-ref=forgejo-${fgNum}`, `--notes=Forgejo: ${fgUrl}`]);
  if (!r.ok) {
    console.log(`    WARNING: Could not update ${beadId} external-ref: ${r.stderr}`);
  }
  if (beadsStatusToForgejo(bdStatus) === "closed") {
    try {
      await client.rawRequest("PATCH", `/repos/${owner}/${repo}/issues/${fgNum}`, { state: "closed" });
      console.log(`    Closed Forgejo #${fgNum} (matches beads state)`);
    } catch {
      console.log(`    WARNING: Could not close Forgejo #${fgNum}`);
    }
  }
  return true;
}
function doSyncToBeads(bd, targetState) {
  const beadId = bd.id;
  let r;
  if (targetState === "closed") {
    r = bdRun(["close", beadId, "--reason=Synced from Forgejo"]);
  } else {
    r = bdRun(["reopen", beadId, "--reason=Synced from Forgejo"]);
  }
  if (!r.ok) {
    console.log(`    FAILED: ${r.stderr}`);
    return false;
  }
  console.log(`    Updated ${beadId} \u2192 ${targetState}`);
  return true;
}
async function doSyncToForgejo(fg, targetState, client, owner, repo) {
  const num = fg.number;
  try {
    await client.rawRequest("PATCH", `/repos/${owner}/${repo}/issues/${num}`, { state: targetState });
  } catch {
    console.log(`    FAILED: Could not update Forgejo #${num}`);
    return false;
  }
  console.log(`    Updated Forgejo #${num} \u2192 ${targetState}`);
  return true;
}
function migrateRefs(beadsIssues) {
  let migrated = 0;
  let skippedCount = 0;
  for (const bd of beadsIssues) {
    if (bd.external_ref)
      continue;
    const fgNum = parseForgejoNumberFromNotes(bd.notes);
    if (fgNum === null)
      continue;
    const beadId = bd.id;
    const ref = `forgejo-${fgNum}`;
    const r = bdRun(["update", beadId, `--external-ref=${ref}`]);
    if (r.ok) {
      console.log(`  Set ${beadId} external-ref \u2192 ${ref}`);
      migrated++;
    } else {
      console.log(`  FAILED ${beadId}: ${r.stderr}`);
      skippedCount++;
    }
  }
  console.log(`
Migration complete: ${migrated} updated, ${skippedCount} failed`);
}
async function main() {
  const args = process.argv.slice(2);
  const executeMode = args.includes("--execute");
  const migrateRefsMode = args.includes("--migrate-refs");
  const [host, owner, repo] = detectRemote();
  console.log(`Forgejo instance: https://${host}/${owner}/${repo}`);
  const token = loadToken(host);
  if (!token) {
    console.log("NOTE: No token found. Export/write operations will be skipped.");
  }
  console.log("\nFetching beads issues...");
  const beadsIssues = bdExport();
  console.log(`  Found ${beadsIssues.length} beads issues`);
  if (migrateRefsMode) {
    console.log("\n--- Migrate Refs Mode ---");
    migrateRefs(beadsIssues);
    return;
  }
  const client = new ForgejoClient({
    instanceUrl: `https://${host}`,
    token: token || void 0
  });
  console.log("\nFetching Forgejo issues...");
  const forgejoIssues = await fetchForgejoIssues(client, owner, repo);
  console.log(`  Found ${forgejoIssues.length} Forgejo issues`);
  console.log("\n--- Sync Plan ---");
  const actions = buildSyncPlan(forgejoIssues, beadsIssues, host, owner, repo);
  if (actions.length === 0) {
    console.log("\n  No changes needed. Everything is in sync!");
    return;
  }
  const imports = actions.filter((a) => a.action === "import").length;
  const exports = actions.filter((a) => a.action === "export").length;
  const syncs = actions.filter((a) => a.action === "sync_status").length;
  console.log(`
  Import (Forgejo\u2192beads): ${imports}`);
  console.log(`  Export (beads\u2192Forgejo): ${exports}`);
  console.log(`  Status sync:           ${syncs}`);
  console.log(`  Total actions:         ${actions.length}`);
  const dryRun = !executeMode;
  if (dryRun) {
    console.log("\n--- Dry Run (use --execute to apply) ---");
  } else {
    console.log("\n--- Executing ---");
  }
  const [succeeded, failed, skipped] = await executeActions(
    actions,
    client,
    host,
    owner,
    repo,
    token,
    dryRun
  );
  console.log("\n--- Summary ---");
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Skipped:   ${skipped}`);
}
main().catch((e) => {
  console.error(`ERROR: ${e}`);
  process.exit(1);
});
