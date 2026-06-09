"""
Weekly portfolio digest — fetch last-7-day workspace activity from synced
graph tables, generate a 5-bullet summary via Claude, and email via Resend.

Designed to be called by the Celery beat task `digest.send_weekly_digest`
every Monday at 08:00 UTC.  run_weekly_digest() is also callable directly
from the admin endpoint for manual trigger / testing.
"""
from __future__ import annotations

import html as _html
import os
from datetime import date, datetime, timezone, timedelta
from typing import Any

import structlog

from app.db.postgres import get_pool
from app.services.claude import complete_claude
from app.services.email import _send as _send_email

log = structlog.get_logger()

DIGEST_FROM = os.getenv("DIGEST_FROM_EMAIL", "FOUND3RY <noreply@found3ry.com>")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


# ─── Data fetching ────────────────────────────────────────────────────────────

async def _fetch_activity(conn, workspace_id: str) -> dict[str, Any]:
    """Return last-7-day activity from synced events / docs / graph_tasks."""
    since = datetime.now(timezone.utc) - timedelta(days=7)

    commits = await conn.fetch(
        """SELECT title, occurred_at
           FROM events
           WHERE workspace_id=$1
             AND source='github'
             AND source_kind='commit'
             AND occurred_at > $2
           ORDER BY occurred_at DESC
           LIMIT 20""",
        workspace_id, since,
    )

    notion_pages = await conn.fetch(
        """SELECT title, source_updated_at
           FROM docs
           WHERE workspace_id=$1
             AND source='notion'
             AND source_updated_at > $2
           ORDER BY source_updated_at DESC
           LIMIT 20""",
        workspace_id, since,
    )

    linear_closed = await conn.fetch(
        """SELECT title, completed_at
           FROM graph_tasks
           WHERE workspace_id=$1
             AND source='linear'
             AND completed_at > $2
           ORDER BY completed_at DESC
           LIMIT 20""",
        workspace_id, since,
    )

    return {
        "commits": [dict(r) for r in commits],
        "notion_pages": [dict(r) for r in notion_pages],
        "linear_closed": [dict(r) for r in linear_closed],
    }


# ─── Claude summariser ────────────────────────────────────────────────────────

def _build_prompt(workspace_name: str, activity: dict[str, Any]) -> str:
    def titles(items: list[dict], key: str = "title") -> str:
        lines = [f"- {r[key]}" for r in items if r.get(key)][:10]
        return "\n".join(lines) if lines else "None this week"

    return f"""You are writing a weekly digest email for the FOUND3RY workspace "{workspace_name}".

ACTIVITY THIS WEEK:
GitHub commits ({len(activity['commits'])} total):
{titles(activity['commits'])}

Notion pages updated ({len(activity['notion_pages'])} total):
{titles(activity['notion_pages'])}

Linear issues closed ({len(activity['linear_closed'])} total):
{titles(activity['linear_closed'])}

Write exactly 5 concise, specific bullets summarising the week.
Rules:
- Each bullet is 1–2 sentences, direct and specific
- Reference real work items where data exists
- Use active builder language: shipped, merged, drafted, closed, built, etc.
- If a category has no data, draw insight from what IS there — never write "no activity"
- No commentary, no headers, no intro sentence

Return only the 5 bullets, one per line, each starting with "• "."""


# ─── HTML email renderer ──────────────────────────────────────────────────────

def _render_html(workspace_name: str, bullets: str, week_label: str) -> str:
    safe_workspace_name = _html.escape(workspace_name)
    rows = ""
    for i, line in enumerate(bullets.strip().splitlines()[:5]):
        text = line.lstrip("•").strip()
        if not text:
            continue
        bg = "#1a1a18" if i % 2 == 0 else "#141413"
        rows += f"""
          <tr>
            <td style="padding:14px 20px;border-left:3px solid #E84A0E;background:{bg};
                       color:#F2F2EE;font-family:'IBM Plex Mono',monospace,sans-serif;
                       font-size:13px;line-height:1.7;margin-bottom:4px;">
              {_html.escape(text)}
            </td>
          </tr>
          <tr><td style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FOUND3RY Weekly Digest</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0b;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0b;padding:40px 16px;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

    <!-- Wordmark + label -->
    <tr>
      <td style="padding:0 0 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;
                       font-weight:900;color:#F2F2EE;letter-spacing:1px;">
              F<span style="background:#E84A0E;color:#141413;padding:0 3px;">O</span>UND3RY
            </td>
            <td align="right"
                style="font-family:'IBM Plex Mono',monospace,sans-serif;
                       font-size:10px;color:#555;letter-spacing:2px;text-transform:uppercase;">
              Weekly Digest
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Week + workspace name -->
    <tr>
      <td style="padding:0 0 6px 0;">
        <p style="margin:0;font-family:'IBM Plex Mono',monospace,sans-serif;
                  font-size:10px;color:#E84A0E;letter-spacing:3px;text-transform:uppercase;">
          {week_label}
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 28px 0;">
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;
                   font-size:28px;font-weight:900;color:#F2F2EE;line-height:1.15;">
          {safe_workspace_name}
        </h1>
      </td>
    </tr>

    <!-- Accent divider -->
    <tr>
      <td style="padding:0 0 24px 0;height:2px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="60" style="height:2px;background:#E84A0E;font-size:0;">&nbsp;</td>
            <td style="height:2px;background:#222;font-size:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- 5 Bullets -->
    <tr>
      <td style="padding:0 0 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          {rows}
        </table>
      </td>
    </tr>

    <!-- CTA -->
    <tr>
      <td style="padding:0 0 40px 0;">
        <a href="{FRONTEND_URL}"
           style="display:inline-block;padding:12px 28px;background:#E84A0E;
                  color:#F2F2EE;text-decoration:none;
                  font-family:'IBM Plex Mono',monospace,sans-serif;
                  font-size:11px;letter-spacing:2px;text-transform:uppercase;">
          OPEN WORKSPACE →
        </a>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="border-top:1px solid #1f1f1d;padding:24px 0 0 0;">
        <p style="margin:0;font-family:'IBM Plex Mono',monospace,sans-serif;
                  font-size:10px;color:#3a3a38;line-height:1.7;">
          You're receiving this because your workspace is connected to FOUND3RY.<br>
          Digest delivered every Monday at 08:00 UTC.
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>"""


# ─── Per-workspace orchestration ─────────────────────────────────────────────

async def send_digest_for_workspace(
    conn,
    workspace_id: str,
    workspace_name: str,
    owner_email: str,
) -> bool:
    """
    Fetch 7-day activity, generate bullets, send email, stamp last_digest_sent_at.
    Returns True if email was sent, False if skipped (no activity).
    Exceptions are caught and logged — never propagates to the caller.
    """
    try:
        activity = await _fetch_activity(conn, workspace_id)

        total = (
            len(activity["commits"])
            + len(activity["notion_pages"])
            + len(activity["linear_closed"])
        )
        if total == 0:
            log.info("digest_skip_no_activity", workspace_id=workspace_id)
            # Still stamp so we don't recheck every hour on idle workspaces.
            await conn.execute(
                "UPDATE workspaces SET last_digest_sent_at = NOW() WHERE id = $1",
                workspace_id,
            )
            return False

        prompt = _build_prompt(workspace_name, activity)
        bullets = await complete_claude(
            system=(
                "You write crisp, specific weekly digest bullets for a founder's workspace. "
                "Return only the requested bullets — no prose, no headers."
            ),
            user=prompt,
            max_tokens=500,
        )

        week_label = f"Week of {date.today().strftime('%B %d, %Y')}"
        html = _render_html(workspace_name, bullets, week_label)

        await _send_email(
            to=owner_email,
            subject=f"Your FOUND3RY week — {workspace_name}",
            html=html,
            email_type="weekly_digest",
            from_email=DIGEST_FROM,
        )

        await conn.execute(
            "UPDATE workspaces SET last_digest_sent_at = NOW() WHERE id = $1",
            workspace_id,
        )
        log.info(
            "digest_sent",
            workspace_id=workspace_id,
            to=owner_email,
            github_commits=len(activity["commits"]),
            notion_pages=len(activity["notion_pages"]),
            linear_closed=len(activity["linear_closed"]),
        )
        return True

    except Exception as exc:
        log.error("digest_failed", workspace_id=workspace_id, error=str(exc))
        return False


# ─── Top-level job ────────────────────────────────────────────────────────────

async def run_weekly_digest() -> dict[str, int]:
    """
    Query all workspaces due for a digest and process them serially.

    A workspace is eligible when:
    - Its owner has a non-null email
    - It has at least one active OAuth connection (GitHub/Linear/Notion)
    - It hasn't received a digest in the past 7 days (or never has)
    """
    pool = await get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT w.id, w.name, u.email
            FROM workspaces w
            JOIN users u ON u.id = w.owner_id
            WHERE u.email IS NOT NULL
              AND (
                w.last_digest_sent_at IS NULL
                OR w.last_digest_sent_at < NOW() - INTERVAL '7 days'
              )
              AND EXISTS (
                SELECT 1
                FROM oauth_connections oc
                WHERE oc.workspace_id = w.id
                  AND oc.revoked_at IS NULL
              )
            ORDER BY w.created_at
            """
        )

    log.info("digest_run_start", eligible=len(rows))
    sent = skipped = 0

    for row in rows:
        async with pool.acquire() as conn:
            ok = await send_digest_for_workspace(
                conn=conn,
                workspace_id=str(row["id"]),
                workspace_name=row["name"],
                owner_email=row["email"],
            )
        if ok:
            sent += 1
        else:
            skipped += 1

    log.info("digest_run_complete", sent=sent, skipped=skipped)
    return {"sent": sent, "skipped": skipped}
