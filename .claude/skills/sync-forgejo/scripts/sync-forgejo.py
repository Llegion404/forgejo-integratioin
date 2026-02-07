#!/usr/bin/env python3
"""Bidirectional sync between beads issue tracker and Forgejo."""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime


# ---------------------------------------------------------------------------
# Git remote detection
# ---------------------------------------------------------------------------

def detect_remote():
    """Return (host, owner, repo) from git remote origin."""
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"], text=True
        ).strip()
    except subprocess.CalledProcessError:
        sys.exit("ERROR: Could not get git remote URL. Are you in a git repo?")

    # HTTPS: https://host/owner/repo.git
    m = re.match(r"https?://([^/]+)/([^/]+)/([^/.]+?)(?:\.git)?$", url)
    if m:
        return m.group(1), m.group(2), m.group(3)

    # SSH protocol: ssh://git@host/owner/repo.git
    m = re.match(r"ssh://(?:git@)?([^/]+)/([^/]+)/([^/.]+?)(?:\.git)?$", url)
    if m:
        return m.group(1), m.group(2), m.group(3)

    # SSH scp-style: git@host:owner/repo.git
    m = re.match(r"git@([^:]+):([^/]+)/([^/.]+?)(?:\.git)?$", url)
    if m:
        return m.group(1), m.group(2), m.group(3)

    sys.exit(f"ERROR: Could not parse git remote URL: {url}")


# ---------------------------------------------------------------------------
# Forgejo API helpers
# ---------------------------------------------------------------------------

def forgejo_get(host, endpoint, token=None):
    """GET from Forgejo API v1. Returns parsed JSON."""
    url = f"https://{host}/api/v1{endpoint}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    if token:
        req.add_header("Authorization", f"token {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  WARNING: GET {url} failed: HTTP {e.code}", file=sys.stderr)
        return None


def forgejo_post(host, endpoint, data, token):
    """POST JSON to Forgejo API v1. Returns parsed JSON."""
    url = f"https://{host}/api/v1{endpoint}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"token {token}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        print(f"  WARNING: POST {url} failed: HTTP {e.code} {body_text}", file=sys.stderr)
        return None


def forgejo_patch(host, endpoint, data, token):
    """PATCH JSON to Forgejo API v1. Returns parsed JSON."""
    url = f"https://{host}/api/v1{endpoint}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"token {token}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        print(f"  WARNING: PATCH {url} failed: HTTP {e.code} {body_text}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Forgejo issue fetching (all states, filter out PRs)
# ---------------------------------------------------------------------------

def fetch_forgejo_issues(host, owner, repo, token=None):
    """Fetch all open + closed issues from Forgejo, excluding PRs."""
    issues = []
    for state in ("open", "closed"):
        page = 1
        while True:
            data = forgejo_get(
                host,
                f"/repos/{owner}/{repo}/issues?state={state}&type=issues&limit=50&page={page}",
                token,
            )
            if data is None:
                break
            # Filter out PRs (they have a pull_request field)
            batch = [i for i in data if not i.get("pull_request")]
            issues.extend(batch)
            if len(data) < 50:
                break
            page += 1
    return issues


# ---------------------------------------------------------------------------
# Beads helpers
# ---------------------------------------------------------------------------

def bd_export():
    """Run bd export and return list of dicts."""
    try:
        out = subprocess.check_output(
            ["bd", "export"], text=True, stderr=subprocess.PIPE
        )
    except subprocess.CalledProcessError as e:
        print(f"  WARNING: bd export failed: {e.stderr}", file=sys.stderr)
        return []
    items = []
    for line in out.strip().splitlines():
        line = line.strip()
        if line:
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return items


def bd_run(args, label="bd"):
    """Run a bd command, return (success, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["bd"] + args,
            capture_output=True, text=True,
        )
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except Exception as e:
        return False, "", str(e)


# ---------------------------------------------------------------------------
# Linking logic
# ---------------------------------------------------------------------------

EXTERNAL_REF_RE = re.compile(r"^forgejo-(\d+)$")
NOTES_URL_RE = re.compile(r"/issues/(\d+)")


def parse_forgejo_number_from_ref(ref):
    """Extract Forgejo issue number from external-ref like 'forgejo-25'."""
    if not ref:
        return None
    m = EXTERNAL_REF_RE.match(ref)
    return int(m.group(1)) if m else None


def parse_forgejo_number_from_notes(notes):
    """Extract Forgejo issue number from notes URL."""
    if not notes:
        return None
    m = NOTES_URL_RE.search(notes)
    return int(m.group(1)) if m else None


def infer_type(title):
    """Infer beads issue type from title prefix."""
    lower = title.lower()
    if lower.startswith("bug:") or lower.startswith("bug ") or "bug" in lower.split()[:2]:
        return "bug"
    if lower.startswith("feat:") or lower.startswith("feat ") or lower.startswith("feature:"):
        return "feature"
    return "task"


def beads_status_to_forgejo(status):
    """Map beads status to Forgejo state."""
    if status in ("open", "in_progress", "blocked"):
        return "open"
    return "closed"


def parse_iso(ts):
    """Parse an ISO timestamp string to a datetime. Returns None on failure."""
    if not ts:
        return None
    # Handle various ISO formats
    ts = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Core sync logic
# ---------------------------------------------------------------------------

def build_sync_plan(forgejo_issues, beads_issues, host, owner, repo):
    """
    Returns a list of action dicts:
      {"action": "import"|"export"|"sync_status",
       "forgejo": {...}|None,
       "beads": {...}|None,
       "detail": str}
    """
    # Index Forgejo issues by number
    fg_by_num = {i["number"]: i for i in forgejo_issues}

    # Index beads issues by Forgejo number (via external-ref or notes)
    bd_by_fg_num = {}
    bd_unlinked = []
    for b in beads_issues:
        fg_num = parse_forgejo_number_from_ref(b.get("external_ref"))
        if fg_num is None:
            fg_num = parse_forgejo_number_from_notes(b.get("notes"))
        if fg_num is not None:
            bd_by_fg_num[fg_num] = b
        else:
            bd_unlinked.append(b)

    actions = []

    # Forgejo issues not in beads → import
    for num, fg in fg_by_num.items():
        if num not in bd_by_fg_num:
            actions.append({
                "action": "import",
                "forgejo": fg,
                "beads": None,
                "detail": f"Import Forgejo #{num}: {fg['title']}",
            })

    # Matched pairs → check status
    for num, bd in bd_by_fg_num.items():
        fg = fg_by_num.get(num)
        if fg is None:
            # Forgejo issue was deleted? Skip.
            continue
        bd_state = beads_status_to_forgejo(bd.get("status", "open"))
        fg_state = fg.get("state", "open")
        if bd_state != fg_state:
            # Determine which is newer
            bd_ts = parse_iso(bd.get("updated_at"))
            fg_ts = parse_iso(fg.get("updated_at"))
            if bd_ts and fg_ts and bd_ts > fg_ts:
                direction = "beads→forgejo"
                target_state = bd_state
            else:
                # Forgejo wins ties
                direction = "forgejo→beads"
                target_state = fg_state
            actions.append({
                "action": "sync_status",
                "forgejo": fg,
                "beads": bd,
                "detail": f"Sync #{num} status: {direction} → {target_state}",
                "direction": direction,
                "target_state": target_state,
            })

    # Beads-only issues (no external-ref, no notes link) → export
    for bd in bd_unlinked:
        actions.append({
            "action": "export",
            "forgejo": None,
            "beads": bd,
            "detail": f"Export beads {bd['id']}: {bd['title']}",
        })

    return actions


# ---------------------------------------------------------------------------
# Execute actions
# ---------------------------------------------------------------------------

def execute_actions(actions, host, owner, repo, token, dry_run=True):
    """Execute or report planned actions. Returns (succeeded, failed, skipped)."""
    succeeded = 0
    failed = 0
    skipped = 0

    for act in actions:
        print(f"\n  {'[DRY RUN] ' if dry_run else ''}» {act['detail']}")

        if dry_run:
            skipped += 1
            continue

        if act["action"] == "import":
            if not do_import(act["forgejo"], host, owner, repo):
                failed += 1
            else:
                succeeded += 1

        elif act["action"] == "export":
            if not token:
                print("    SKIP: No FORGEJO_TOKEN set, cannot create Forgejo issues")
                skipped += 1
                continue
            if not do_export(act["beads"], host, owner, repo, token):
                failed += 1
            else:
                succeeded += 1

        elif act["action"] == "sync_status":
            direction = act.get("direction", "forgejo→beads")
            target = act.get("target_state", "open")
            if direction == "forgejo→beads":
                if not do_sync_to_beads(act["beads"], target):
                    failed += 1
                else:
                    succeeded += 1
            else:
                if not token:
                    print("    SKIP: No FORGEJO_TOKEN set, cannot update Forgejo")
                    skipped += 1
                    continue
                if not do_sync_to_forgejo(act["forgejo"], target, host, owner, repo, token):
                    failed += 1
                else:
                    succeeded += 1

    return succeeded, failed, skipped


def do_import(fg, host, owner, repo):
    """Create a beads issue from a Forgejo issue."""
    num = fg["number"]
    title = fg["title"]
    body = fg.get("body") or ""
    fg_url = f"https://{host}/{owner}/{repo}/issues/{num}"
    issue_type = infer_type(title)
    fg_state = fg.get("state", "open")

    # Truncate body for description (bd has limits)
    desc = body[:2000] if body else title

    args = [
        "create",
        f"--title={title}",
        f"--type={issue_type}",
        f"--external-ref=forgejo-{num}",
        f"--notes=Forgejo: {fg_url}",
        f"--description={desc}",
        "--silent",
    ]
    ok, stdout, stderr = bd_run(args, f"import #{num}")
    if not ok:
        print(f"    FAILED: bd create: {stderr}")
        return False

    bead_id = stdout.strip().splitlines()[-1].strip() if stdout.strip() else None
    print(f"    Created beads issue: {bead_id}")

    # If Forgejo issue is closed, close in beads too
    if fg_state == "closed" and bead_id:
        ok2, _, stderr2 = bd_run(
            ["close", bead_id, f"--reason=Closed on Forgejo"],
            f"close {bead_id}",
        )
        if ok2:
            print(f"    Closed {bead_id} (matches Forgejo state)")
        else:
            print(f"    WARNING: Could not close {bead_id}: {stderr2}")

    return True


def do_export(bd, host, owner, repo, token):
    """Create a Forgejo issue from a beads issue."""
    bead_id = bd["id"]
    title = bd["title"]
    desc = bd.get("description") or ""
    bd_status = bd.get("status", "open")

    body = desc
    if body:
        body += "\n\n"
    body += f"_Synced from beads issue `{bead_id}`_"

    result = forgejo_post(
        host,
        f"/repos/{owner}/{repo}/issues",
        {"title": title, "body": body},
        token,
    )
    if result is None:
        print(f"    FAILED: Could not create Forgejo issue for {bead_id}")
        return False

    fg_num = result["number"]
    fg_url = f"https://{host}/{owner}/{repo}/issues/{fg_num}"
    print(f"    Created Forgejo #{fg_num}: {fg_url}")

    # Set external-ref and notes on beads issue
    ok, _, stderr = bd_run(
        ["update", bead_id, f"--external-ref=forgejo-{fg_num}", f"--notes=Forgejo: {fg_url}"],
        f"update {bead_id}",
    )
    if not ok:
        print(f"    WARNING: Could not update {bead_id} external-ref: {stderr}")

    # If beads issue is closed, close on Forgejo too
    if beads_status_to_forgejo(bd_status) == "closed":
        r = forgejo_patch(
            host,
            f"/repos/{owner}/{repo}/issues/{fg_num}",
            {"state": "closed"},
            token,
        )
        if r:
            print(f"    Closed Forgejo #{fg_num} (matches beads state)")
        else:
            print(f"    WARNING: Could not close Forgejo #{fg_num}")

    return True


def do_sync_to_beads(bd, target_state):
    """Sync status from Forgejo to beads."""
    bead_id = bd["id"]
    if target_state == "closed":
        ok, _, stderr = bd_run(
            ["close", bead_id, "--reason=Synced from Forgejo"],
            f"close {bead_id}",
        )
    else:
        ok, _, stderr = bd_run(
            ["reopen", bead_id, "--reason=Synced from Forgejo"],
            f"reopen {bead_id}",
        )
    if not ok:
        print(f"    FAILED: {stderr}")
        return False
    print(f"    Updated {bead_id} → {target_state}")
    return True


def do_sync_to_forgejo(fg, target_state, host, owner, repo, token):
    """Sync status from beads to Forgejo."""
    num = fg["number"]
    r = forgejo_patch(
        host,
        f"/repos/{owner}/{repo}/issues/{num}",
        {"state": target_state},
        token,
    )
    if r is None:
        print(f"    FAILED: Could not update Forgejo #{num}")
        return False
    print(f"    Updated Forgejo #{num} → {target_state}")
    return True


# ---------------------------------------------------------------------------
# Migrate refs (one-time)
# ---------------------------------------------------------------------------

def migrate_refs(beads_issues):
    """Set external-ref from notes field URLs for existing issues."""
    migrated = 0
    skipped = 0
    for bd in beads_issues:
        # Already has external-ref? Skip.
        if bd.get("external_ref"):
            continue
        fg_num = parse_forgejo_number_from_notes(bd.get("notes"))
        if fg_num is None:
            continue
        bead_id = bd["id"]
        ref = f"forgejo-{fg_num}"
        ok, _, stderr = bd_run(
            ["update", bead_id, f"--external-ref={ref}"],
            f"migrate {bead_id}",
        )
        if ok:
            print(f"  Set {bead_id} external-ref → {ref}")
            migrated += 1
        else:
            print(f"  FAILED {bead_id}: {stderr}")
            skipped += 1
    print(f"\nMigration complete: {migrated} updated, {skipped} failed")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Bidirectional sync between beads and Forgejo issues"
    )
    parser.add_argument(
        "--execute", action="store_true",
        help="Apply changes (default is dry-run)",
    )
    parser.add_argument(
        "--migrate-refs", action="store_true",
        help="One-time: set external-ref from notes field URLs",
    )
    args = parser.parse_args()

    # Detect remote
    host, owner, repo = detect_remote()
    print(f"Forgejo instance: https://{host}/{owner}/{repo}")

    token = os.environ.get("FORGEJO_TOKEN", "")
    if not token:
        print("NOTE: FORGEJO_TOKEN not set. Export/write operations will be skipped.")

    # Export beads issues
    print("\nFetching beads issues...")
    beads_issues = bd_export()
    print(f"  Found {len(beads_issues)} beads issues")

    # Migrate-refs mode
    if args.migrate_refs:
        print("\n--- Migrate Refs Mode ---")
        migrate_refs(beads_issues)
        return

    # Fetch Forgejo issues
    print("\nFetching Forgejo issues...")
    forgejo_issues = fetch_forgejo_issues(host, owner, repo, token or None)
    print(f"  Found {len(forgejo_issues)} Forgejo issues")

    # Build sync plan
    print("\n--- Sync Plan ---")
    actions = build_sync_plan(forgejo_issues, beads_issues, host, owner, repo)

    if not actions:
        print("\n  No changes needed. Everything is in sync!")
        return

    # Summarize
    imports = sum(1 for a in actions if a["action"] == "import")
    exports = sum(1 for a in actions if a["action"] == "export")
    syncs = sum(1 for a in actions if a["action"] == "sync_status")
    print(f"\n  Import (Forgejo→beads): {imports}")
    print(f"  Export (beads→Forgejo): {exports}")
    print(f"  Status sync:           {syncs}")
    print(f"  Total actions:         {len(actions)}")

    # Execute
    dry_run = not args.execute
    if dry_run:
        print("\n--- Dry Run (use --execute to apply) ---")
    else:
        print("\n--- Executing ---")

    succeeded, failed, skipped = execute_actions(
        actions, host, owner, repo, token, dry_run=dry_run
    )

    print(f"\n--- Summary ---")
    print(f"  Succeeded: {succeeded}")
    print(f"  Failed:    {failed}")
    print(f"  Skipped:   {skipped}")


if __name__ == "__main__":
    main()
