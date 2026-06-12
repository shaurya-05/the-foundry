import html as _html
import os
import secrets
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from app.db.postgres import get_pool
import structlog

log = structlog.get_logger()
router = APIRouter(tags=["admin"])
_security = HTTPBasic()


def _require_admin(credentials: HTTPBasicCredentials = Depends(_security)):
    password = os.getenv("ADMIN_PASSWORD", "")
    if not password:
        raise HTTPException(status_code=503, detail="ADMIN_PASSWORD not configured")
    ok = secrets.compare_digest(credentials.password.encode(), password.encode())
    if not ok:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": 'Basic realm="FOUNDRY Admin"'},
        )
    return credentials


@router.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(_: HTTPBasicCredentials = Depends(_require_admin)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        total_signups = await conn.fetchval("SELECT COUNT(*) FROM workspaces")
        onboarding_done = await conn.fetchval(
            "SELECT COUNT(*) FROM workspaces WHERE onboarding_completed_at IS NOT NULL"
        )
        # Workspaces that hit any Spark ceiling in any billing period
        spark_limit_hits = await conn.fetchval(
            """SELECT COUNT(DISTINCT workspace_id) FROM usage_tracking
               WHERE copilot_messages >= 25 OR agent_runs >= 10 OR forge_operations >= 3"""
        )
        paid_conversions = await conn.fetchval(
            "SELECT COUNT(*) FROM workspaces WHERE plan = 'growth'"
        )
        # Recent signups for the table
        recent_rows = await conn.fetch(
            """SELECT name, plan, onboarding_step, onboarding_completed_at, created_at
               FROM workspaces
               ORDER BY created_at DESC
               LIMIT 20"""
        )

    onboarding_pct = (
        round(onboarding_done / total_signups * 100, 1) if total_signups else 0
    )
    conversion_pct = (
        round(paid_conversions / total_signups * 100, 1) if total_signups else 0
    )

    def _row_html(r) -> str:
        plan_label = r["plan"] or "spark"
        plan_color = "#E84A0E" if plan_label == "growth" else "#666"
        ob_done = "✓" if r["onboarding_completed_at"] else "—"
        ts = r["created_at"].strftime("%Y-%m-%d") if r["created_at"] else "—"
        name = _html.escape(r["name"] or "—")
        return (
            f"<tr>"
            f"<td>{name}</td>"
            f"<td style='color:{plan_color};font-weight:600'>{_html.escape(plan_label)}</td>"
            f"<td style='text-align:center'>{r['onboarding_step']}</td>"
            f"<td style='text-align:center'>{ob_done}</td>"
            f"<td style='color:#888'>{ts}</td>"
            f"</tr>"
        )

    rows_html = "".join(_row_html(r) for r in recent_rows)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FOUNDRY Admin</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: #141413;
    color: #F2F2EE;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 14px;
    line-height: 1.6;
    padding: 40px 32px;
  }}
  h1 {{ font-size: 20px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }}
  .sub {{ color: #666; font-size: 12px; margin-bottom: 40px; }}
  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 48px;
  }}
  .card {{
    background: #1c1c1a;
    border: 1px solid #2a2a28;
    padding: 24px 20px;
  }}
  .card-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #666; margin-bottom: 8px; }}
  .card-value {{ font-size: 36px; font-weight: 700; color: #F2F2EE; line-height: 1; }}
  .card-sub {{ font-size: 11px; color: #888; margin-top: 6px; }}
  .accent {{ color: #E84A0E; }}
  h2 {{ font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 16px; border-bottom: 1px solid #2a2a28; padding-bottom: 8px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th {{
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #555;
    padding: 8px 12px;
    border-bottom: 1px solid #2a2a28;
  }}
  td {{ padding: 10px 12px; border-bottom: 1px solid #1e1e1c; font-size: 13px; }}
  tr:last-child td {{ border-bottom: none; }}
  tr:hover td {{ background: #1c1c1a; }}
  .refresh {{ font-size: 11px; color: #444; text-align: right; margin-top: 32px; }}
</style>
</head>
<body>
<h1>F<span class="accent">O</span>UNDRY <span class="accent">—</span> Admin</h1>
<div class="sub">Live metrics · {total_signups} total workspace{'' if total_signups == 1 else 's'}</div>

<div class="grid">
  <div class="card">
    <div class="card-label">Total Signups</div>
    <div class="card-value">{total_signups}</div>
    <div class="card-sub">All workspaces ever created</div>
  </div>
  <div class="card">
    <div class="card-label">Onboarding Rate</div>
    <div class="card-value">{onboarding_pct}<span style="font-size:18px">%</span></div>
    <div class="card-sub">{onboarding_done} of {total_signups} completed</div>
  </div>
  <div class="card">
    <div class="card-label">Hit Spark Limits</div>
    <div class="card-value">{spark_limit_hits}</div>
    <div class="card-sub">Workspaces that maxed a Spark quota</div>
  </div>
  <div class="card">
    <div class="card-label">Paid (Growth)</div>
    <div class="card-value accent">{paid_conversions}</div>
    <div class="card-sub">{conversion_pct}% conversion rate</div>
  </div>
</div>

<h2>Recent Workspaces</h2>
<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Plan</th>
      <th>Ob. Step</th>
      <th>Ob. Done</th>
      <th>Signed Up</th>
    </tr>
  </thead>
  <tbody>
    {rows_html}
  </tbody>
</table>

<div class="refresh">Auto-refreshes on page reload &middot; cached data may lag ~5 min for plan checks</div>
</body>
</html>"""

    return HTMLResponse(content=html)


@router.post("/admin/digest/trigger")
async def trigger_digest(_: HTTPBasicCredentials = Depends(_require_admin)):
    """Manually trigger the weekly digest for all eligible workspaces."""
    from app.services.digest import run_weekly_digest
    result = await run_weekly_digest()
    log.info("admin_digest_trigger", **result)
    return {"ok": True, **result}

@router.get("/stats/model-usage")
async def model_usage_stats(_: HTTPBasicCredentials = Depends(_require_admin)):
    """Returns breakdown of AI model usage across all copilot messages."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT 
                COALESCE(model_used, 'claude-sonnet-4') as model,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
            FROM copilot_messages
            WHERE role = 'assistant'
            GROUP BY model_used
            ORDER BY count DESC
            """
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM copilot_messages WHERE role = 'assistant'"
        )
    return {
        "total": total,
        "breakdown": [
            {"model": r["model"], "count": r["count"], "pct": float(r["pct"])}
            for r in rows
        ]
    }
