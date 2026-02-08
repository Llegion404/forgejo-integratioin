# Forgejo VS Code Extension: Marketing Analysis & Growth Strategy

*Generated: 2026-02-08*

## Context

This report synthesizes web research from three parallel investigations into: (1) the competitive landscape of VS Code extensions for git forges, (2) the total addressable market for Forgejo, and (3) best practices for extension discoverability and stickiness. The goal is to identify what will make this extension widely used, easily discoverable, and sticky.

---

## 1. Market Size (TAM Estimation)

### Forgejo/Codeberg Adoption
- **Codeberg** (largest public Forgejo instance): **200,000+ registered users**, **300,000+ repositories** (as of Nov 2025)
- Active user estimate (10-20% of registered): **20,000-40,000 active developers**
- Other Forgejo instances: estimated **10,000-20,000** additional active developers across **500-1,500 instances**
- Notable signal: **Zig programming language migrated from GitHub to Codeberg** (Nov 2025), citing GitHub's "bloated JS framework" and aggressive AI features

### Gitea (API-Compatible Market)
- Gitea Docker image: **100M+ pulls** on Docker Hub
- Conservative active user estimate: **100,000-200,000 developers**
- Forgejo maintains API compatibility with Gitea 1.22, so the extension works for both

### VS Code Penetration
- **75.9% of developers** use VS Code (Stack Overflow 2025 Survey, 49K+ respondents)
- Applying 75% VS Code penetration to target market:

| Segment | Users | VS Code Users (75%) |
|---------|-------|-------------------|
| Codeberg active | 20K-40K | **15K-30K** |
| Other Forgejo instances | 10K-20K | **7.5K-15K** |
| Gitea (compatible) | 50K-100K | **37.5K-75K** |
| **Total addressable** | **80K-160K** | **60K-120K** |

### Core TAM: ~15,000-30,000 (Forgejo-only VS Code users)
### Extended TAM: ~60,000-120,000 (including Gitea-compatible users)

### Growth Drivers
- Privacy backlash against GitHub/Copilot AI training on public code
- Forgejo development activity is **2.5x Gitea's** (3,039 vs 1,228 commits since Jul 2024)
- High-profile migrations (Zig, others) driving awareness
- Forgejo working on **forge federation** (ActivityPub/ForgeFed) - unique differentiator
- Estimated CAGR: **15-25% annually**

### Target Personas
1. **Privacy-first FOSS advocates** (~35%) - reject GitHub/Microsoft, value data sovereignty
2. **Enterprise/regulated industry** (~25%) - finance, healthcare, government needing on-premises
3. **Small team/indie devs** (~20%) - self-hosters, budget-conscious
4. **AI-skeptical developers** (~10%) - oppose telemetry, code training
5. **Migrating Gitea users** (~10%) - concerned about Gitea Ltd's for-profit direction

---

## 2. Competitive Landscape

### Forgejo Extensions (Direct Competition)
- **MalcolmMielle/vsix-forgejo** on Codeberg - minimal adoption, basic PR viewing
- **VS Code Codeberg Pull Request** (medenor-fr) - exists on marketplace
- **No dominant player** - massive first-mover opportunity

### Gitea Extensions (Adjacent Competition)
| Extension | Features | Status |
|-----------|----------|--------|
| Gitea Integration (SakunPanthi) | PR/issue view | Limited, unclear maintenance |
| Gitea-VSCode (ijustdev) | Issue tracker only | **Read-only**, limited |
| Gitea Pull Request Tool (jiyun-tech) | PR tool | Minimal documentation |
| Gitea Issue & Timetracking (Seuma) | Time tracking | Narrow feature set |

**Key finding**: Users explicitly requesting an official, well-maintained extension ([Gitea issue #34637](https://github.com/go-gitea/gitea/issues/34637)): *"Third-party extensions exist but are limited in functionality and not actively maintained"*

### Benchmark: GitHub Pull Requests Extension
The gold standard, with millions of installs. Core features:
- PR listing with customizable queries ("Waiting For My Review", "Assigned To Me")
- Full diff viewing with inline commenting
- PR review actions (approve, request changes, merge)
- Checkout PR branch locally for testing
- Issue management with labels, milestones, assignees
- CI status indicators

### Benchmark: GitLab Workflow Extension
- 174K+ downloads (2020 data; much higher now), 3.8/5 rating
- Merge request review with inline commenting
- **CI/CD pipeline integration** (validate CI config, view job outputs, start pipelines)
- GitLab Duo AI integration
- Security findings/SAST scanning
- Repository browsing without cloning

---

## 3. Feature Gap Analysis

### What We Have (v0.2.0)
- PR listing grouped by state (Open/Draft/Merged/Closed)
- Issue listing with details and comments
- PR file diff viewing in VS Code's diff editor
- Multi-instance support
- Auto-detection from git remote
- Actions (CI/CD) view with re-run, logs
- PR merge and close commands
- Issue creation
- Browser integration (open in browser)
- Diagnostics and output channel

### Critical Missing Features (High Impact on Adoption)
1. **Inline PR commenting** - cannot add comments to specific code lines
2. **PR review workflow** - cannot approve or request changes
3. **PR branch checkout** - cannot test PRs locally
4. **Search/filter** - limited filtering capability

### Important Missing Features (Retention Drivers)
5. **Custom query filters** - "Assigned to me", "Waiting for review"
6. **PR creation from VS Code** - full workflow without browser
7. **Notifications/status bar** - real-time awareness
8. **Labels/assignees management** - complete metadata control

### Our Unique Advantages vs GitHub/GitLab Extensions
- **Multi-instance support** - connect to multiple Forgejo servers simultaneously
- **Self-hosted first** - designed for privacy-conscious, self-hosted workflows
- **Lightweight** - no telemetry, no AI, no bloat
- **Actions support** - CI/CD view already built in
- **Gitea compatible** - works with both Forgejo and Gitea

---

## 4. Discoverability Strategy

### 4a. Marketplace SEO - Immediate Wins

**Add "gitea" to keywords** - this is the single highest-impact change. The extension is API-compatible with Gitea; adding this keyword doubles the addressable search surface.

Recommended keywords:
```json
["forgejo", "gitea", "codeberg", "git", "scm", "pull-request", "issues", "code-review", "self-hosted", "actions"]
```

**Optimize description** to include searchable terms:
```
"Browse Forgejo/Gitea Pull Requests, Issues, and Actions in VS Code. Works with Codeberg and self-hosted instances."
```

**Add icon and galleryBanner** to package.json - the extension currently uses a generic codicon. A custom Forgejo-themed icon significantly improves visual recognition in search results.

### 4b. Open VSX Publication - Critical

**This is essential** for the target market. Forgejo users are FOSS-oriented and many use VSCodium, which uses Open VSX instead of Microsoft's marketplace.

Publishing steps:
```bash
npx ovsx create-namespace maxking --pat <TOKEN>
npx ovsx publish --pat <TOKEN>
```

### 4c. README Improvements

Current README is functional but missing key conversion elements:

**Must add:**
- **Screenshot/GIF at the top** - the `<!-- TODO: Add screenshot here -->` comment needs to be resolved. This is the single biggest README improvement.
- **Marketplace badges** (install count, rating, version, license, Open VSX)
- **Animated GIF** showing core workflow (open folder -> see PRs -> click diff)

**Current README strengths (keep):**
- Quick Start section (4 steps)
- Clear feature list
- Multiple installation methods including Open VSX
- Troubleshooting section

### 4d. Community Integration

**Get listed in Forgejo's official documentation** - file a PR to add an "Editor Integration" section. This is the highest-value community action.

**Other channels:**
- Post on Codeberg Community forum
- Announce in Forgejo Matrix/IRC channels
- Write DEV.to article: "How I built a VS Code extension for Forgejo"
- Reddit: r/vscode, r/selfhosted
- Hacker News (Forgejo community is active there)

---

## 5. Stickiness Strategy

### The Hook (Why Users Install)
Research shows the #1 driver is **reducing context switching** - reviewing PRs without leaving VS Code. The extension already provides this with PR browsing and diff viewing.

### The Retention Feature (Why Users Keep It)
The retention gap is **workflow completeness**. Users install to view PRs but uninstall if they still need to switch to browser for commenting, reviewing, or merging. The extension already has merge/close, which is good. The key missing retention features are:

1. **PR branch checkout** - lets developers test PRs locally without leaving VS Code
2. **Inline commenting** - completes the review workflow
3. **Custom queries** - "Assigned to me" makes it a daily dashboard

### Stickiness Rules (from academic research on 52,880 extensions)
1. **Immediate comprehension** - users must understand value in <30 seconds
2. **Zero/minimal config** - auto-detection is excellent here
3. **Focused scope** - do one thing really well before expanding

---

## 6. Onboarding Journey Analysis: Install -> First Useful Interaction

### Current User Journey (7-8 steps, ~2 minutes)

| Step | Action | Friction |
|------|--------|----------|
| 1 | Install extension | None |
| 2 | See Forgejo sidebar icon + welcome dialog | Low |
| 3 | Click "Get Started" | Low |
| 4 | Enter instance URL (e.g. `https://codeberg.org`) | Medium - user must know their URL |
| 5 | Browser opens to create PAT token | **High** - user leaves VS Code, creates token with correct permissions |
| 6 | Return to VS Code, paste token | Medium - context switch back |
| 7 | Name the instance | Low (auto-suggested) |
| 8 | Open a git repo with matching remote | Low (if already in one) |

**Key friction points**: Steps 5-6 are the biggest barrier. Creating a PAT requires the user to leave VS Code, navigate Forgejo's settings, create token with right scopes, copy it, and return.

### Public Repos (Faster Path - Works Today!)
For public repos (like Codeberg projects), the extension **already works without a token**. The API client sends requests without auth headers when no token is set. However, this path isn't obvious to users because:
- The welcome dialog pushes toward the full onboarding wizard
- There's no clear "skip auth, just browse public repos" option
- Auto-detection from git remote could show data immediately for public repos

### Comparison: GitHub Extension (3-4 clicks)

| Step | GitHub Extension | Forgejo Extension |
|------|-----------------|-------------------|
| 1 | Install | Install |
| 2 | See sidebar with "Sign in" button (viewsWelcome) | See welcome dialog popup |
| 3 | Click "Sign in" -> OAuth in browser | Enter URL -> browser for token -> paste back |
| 4 | PRs appear organized by "Waiting For Review", "Assigned To Me" | PRs appear grouped by Open/Closed/Draft |

**Key differences:**
- GitHub uses **OAuth** (one click, browser auto-returns token) vs Forgejo's **manual PAT entry** (multiple steps, user copies token)
- GitHub shows a **viewsWelcome button** embedded in the tree view vs Forgejo's **dialog popup** that can be dismissed and forgotten
- GitHub organizes PRs by **relevance** ("Waiting For My Review") vs Forgejo's **state** (Open/Closed)

### Recommended Improvements (Priority Order)

**1. Add viewsWelcome content for empty states (P1)**
Instead of a dismissible dialog, show persistent welcome content embedded in the tree views themselves:
```json
"viewsWelcome": [
  {
    "view": "forgejoPullRequests",
    "contents": "Browse Forgejo Pull Requests directly in VS Code.\n[Add Forgejo Instance](command:forgejo.addInstance)\n[Learn More](https://forgejo.org)",
    "when": "forgejo.noInstanceConfigured"
  }
]
```
This matches what GitHub and GitLab extensions do - the button stays visible until the user acts.

**2. Auto-show data for public repos without auth (P1)**
For public repos (Codeberg, public self-hosted), skip the token requirement entirely:
- Detect git remote -> resolve instance URL -> fetch public API data -> show PRs/Issues
- Show a subtle "Sign in for full access" link below the data
- This gets users to value in **0 clicks** after install (just open a public repo)

**3. Add a VS Code Walkthrough (P2)**
VS Code has a built-in walkthrough API that shows guided steps on first install:
```json
"walkthroughs": [{
  "id": "forgejo-getting-started",
  "title": "Get Started with Forgejo",
  "steps": [
    { "title": "Open a Forgejo repository", ... },
    { "title": "Add a personal access token", ... },
    { "title": "Browse your Pull Requests", ... }
  ]
}]
```
This auto-opens on install and provides a structured onboarding experience.

**4. Consider OAuth support (P3, future)**
Forgejo supports OAuth applications. An OAuth flow would reduce auth from 5 steps to 1 click (like GitHub's extension). This is a significant engineering effort but would dramatically improve onboarding.

### Ideal Future Journey (Public Repo)
| Step | Action |
|------|--------|
| 1 | Install extension |
| 2 | Open folder with Forgejo/Codeberg git remote |
| 3 | **PRs and Issues appear automatically** (0 clicks!) |
| 4 | (Optional) Click "Sign in" for write access |

### Ideal Future Journey (Private Repo)
| Step | Action |
|------|--------|
| 1 | Install extension |
| 2 | Open folder with Forgejo git remote |
| 3 | Tree view shows "Sign in to view private repository" button |
| 4 | Click button -> token entry or OAuth |
| 5 | PRs and Issues appear |

---

## 7. Prioritized Recommendations

### Tier 1: Quick Wins (Do This Week)
| Action | Impact | Effort |
|--------|--------|--------|
| Add "gitea" + "self-hosted" + "actions" to keywords | High | 5 min |
| Update description to mention Gitea/Codeberg | High | 5 min |
| Add custom extension icon (Forgejo-themed) | High | 1 hr |
| Add screenshot/GIF to README | High | 2 hrs |
| Add marketplace badges to README | Medium | 30 min |
| Publish to Open VSX | High | 1 hr |

### Tier 2: Community & Marketing (This Month)
| Action | Impact | Effort |
|--------|--------|--------|
| Submit PR to Forgejo docs for editor integration listing | Very High | 2 hrs |
| Post announcement on Codeberg Community | High | 1 hr |
| Write DEV.to article about the extension | High | 4 hrs |
| Add CHANGELOG.md showing active development | Medium | 1 hr |
| Post on r/vscode and r/selfhosted | Medium | 1 hr |

### Tier 3: Feature Development (Next 2-3 Months)
| Feature | Impact on Adoption | Effort |
|---------|-------------------|--------|
| PR branch checkout | Very High (matches GitHub ext) | Medium |
| Inline commenting on PR diffs | Very High (completes review) | High |
| PR review actions (approve/request changes) | High (workflow) | Medium |
| Custom query filters ("Assigned to me") | High (daily use) | Medium |
| Create PR from VS Code | Medium (full workflow) | Medium |

### Tier 4: Differentiation (3-6 Months)
| Feature | Strategic Value |
|---------|----------------|
| Federation-ready cross-instance workflows | Unique to Forgejo |
| Privacy dashboard (show no telemetry) | Trust signal for FOSS users |
| Offline caching for self-hosted | Reliability for enterprise |
| Gitea migration helper | Capture migrating users |

---

## 8. Success Metrics

| Milestone | Installs | Meaning |
|-----------|----------|---------|
| Proof of concept | 100 | Early adopters found you |
| Product-market fit | 500 | Word spreading in community |
| Community traction | 1,000 | Regular organic growth |
| Established tool | 5,000 | De facto standard |
| Market leader | 10,000+ | Dominant Forgejo/Gitea extension |

For reference: GitLens has 40M+ installs, niche SCM extensions typically reach 1K-50K.

---

## Sources

### Market Data
- [Codeberg - Wikipedia](https://en.wikipedia.org/wiki/Codeberg) (200K users, 300K repos)
- [Gitea Docker Hub](https://hub.docker.com/r/gitea/gitea) (100M+ pulls)
- [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/technology) (VS Code 75.9%)
- [Gitea vs Forgejo Development Activity](https://honeypot.net/2025/05/14/gitea-vs-forgejo-development-activity.html)
- [Source Code Hosting Platform Market](https://www.businessresearchinsights.com/market-reports/source-code-hosting-platform-market-116139)

### Competitive Intelligence
- [Feature Request: Official VS Code Extension for Gitea](https://github.com/go-gitea/gitea/issues/34637)
- [GitHub Pull Requests Extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
- [GitLab Workflow Extension](https://marketplace.visualstudio.com/items?itemName=GitLab.gitlab-workflow)
- [Forgejo Comparison with Gitea](https://forgejo.org/compare-to-gitea/)

### Discoverability & Growth
- [VS Code Extension Ecosystem Study](https://arxiv.org/html/2411.07479v1) (52,880 extensions analyzed)
- [Open VSX Registry](https://open-vsx.org/)
- [Publishing to Both Marketplaces](https://dev.to/diana_tang/complete-guide-publishing-vs-code-extensions-to-both-marketplaces-4d58)
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)

### Migration Trends
- [Zig Migrating from GitHub to Codeberg](https://ziglang.org/news/migrating-from-github-to-codeberg/)
- [Forgejo Gitea Compatibility](https://forgejo.org/2024-12-gitea-compatibility/)
- [Self-Hosted Git Platforms 2026](https://dasroot.net/posts/2026/01/self-hosted-git-platforms-gitlab-gitea-forgejo-2026/)

### Onboarding & UX
- [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)
- [VS Code Walkthroughs](https://code.visualstudio.com/api/ux-guidelines/walkthroughs)
- [VS Code Authentication Provider API](https://code.visualstudio.com/api/references/vscode-api#authentication)
- [Welcome View Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/welcome-view-content-sample)
