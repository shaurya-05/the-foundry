"""
GitHub initial-sync orchestrator.

Walks every repo the authed GitHub user can see and lands the contents
into the workspace graph:

    GitHub repo                → ventures            (metadata.github_repo = "owner/name")
    Commit                     → events (kind=commit)
    Commit author/committer    → persons             + edge: participates_in
    Pull request               → graph_tasks (kind=pull_request)
                               + docs (body embedded)
    Issue                      → graph_tasks (kind=issue)
                               + docs (body embedded)
    Author of PR/issue         → persons             + edge: authored_by

Every write is idempotent — re-running the sync just refreshes rows.

Scope budget (per Phase 2 brief §4.1.2 "ingest, don't operate"):
    - We only READ. No issue mutations, no comments, no commit signing.
    - Limit per repo: 200 most-recent commits, 50 PRs, 50 issues.
      This is what fits inside a reasonable initial-sync window for a
      portfolio operator without burning the GitHub rate limit.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

import asyncpg
import structlog

from app.db.postgres import get_pool
from app.services import graph_repo
from app.services.embeddings import embed_batch
from app.services.github_client import GitHubClient, GitHubError
from app.services.oauth_encryption import decrypt_token

log = structlog.get_logger()

# Per-repo caps — keep first sync bounded.
MAX_COMMITS_PER_REPO = int(os.getenv("GITHUB_SYNC_MAX_COMMITS", "200"))
MAX_PULLS_PER_REPO = int(os.getenv("GITHUB_SYNC_MAX_PULLS", "50"))
MAX_ISSUES_PER_REPO = int(os.getenv("GITHUB_SYNC_MAX_ISSUES", "50"))
# Repo cap so an org member with 500 repos doesn't blow up the first sync.
MAX_REPOS = int(os.getenv("GITHUB_SYNC_MAX_REPOS", "30"))


# ─── helpers ───────────────────────────────────────────────────────────────


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    # GitHub timestamps are ISO 8601 with "Z"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _upsert_github_person(
    conn: asyncpg.Connection,
    workspace_id: str,
    actor: Optional[dict],
) -> Optional[str]:
    """Best-effort person upsert from a GitHub user object."""
    if not actor:
        return None
    login = actor.get("login")
    if not login:
        return None
    # GitHub doesn't expose email on REST without scope:user:email; keyed via
    # metadata.github_login dedupe (no email available, so always inserts new
    # row in cold start). We accept that and trust subsequent webhooks /
    # future syncs to consolidate by adding email if/when available.
    person_id = await graph_repo.upsert_person(
        conn,
        workspace_id,
        name=actor.get("name") or login,
        avatar_url=actor.get("avatar_url"),
        metadata={
            "github_login": login,
            "github_user_id": actor.get("id"),
        },
    )
    return person_id


async def _start_sync_job(
    conn: asyncpg.Connection,
    *,
    connection_id: str,
    workspace_id: str,
    provider: str,
) -> str:
    row = await conn.fetchrow(
        """
        INSERT INTO sync_jobs (connection_id, workspace_id, provider, status, started_at)
        VALUES ($1, $2, $3, 'running', NOW())
        RETURNING id
        """,
        connection_id, workspace_id, provider,
    )
    return str(row["id"])


async def _update_sync_job(
    conn: asyncpg.Connection,
    job_id: str,
    *,
    phase: Optional[str] = None,
    progress: Optional[dict] = None,
    status: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    import json
    sets = []
    args: list[Any] = []
    i = 1
    if phase is not None:
        sets.append(f"phase = ${i}"); args.append(phase); i += 1
    if progress is not None:
        sets.append(f"progress = ${i}::jsonb"); args.append(json.dumps(progress)); i += 1
    if status is not None:
        sets.append(f"status = ${i}"); args.append(status); i += 1
        if status in ("completed", "failed"):
            sets.append("completed_at = NOW()")
    if error is not None:
        sets.append(f"error = ${i}"); args.append(error); i += 1
    if not sets:
        return
    args.append(job_id)
    await conn.execute(
        f"UPDATE sync_jobs SET {', '.join(sets)} WHERE id = ${i}",
        *args,
    )


# ─── per-repo ingestion ────────────────────────────────────────────────────


async def _sync_repo(
    conn: asyncpg.Connection,
    gh: GitHubClient,
    workspace_id: str,
    repo: dict,
) -> dict:
    """Ingest one repo. Returns counts for progress reporting."""
    full_name = repo["full_name"]
    owner_login = repo["owner"]["login"]

    venture_id = await graph_repo.upsert_venture(
        conn,
        workspace_id,
        name=repo.get("name") or full_name,
        slug=full_name.replace("/", "__").lower(),
        description=repo.get("description"),
        metadata={
            "github_repo": full_name,
            "github_repo_id": repo.get("id"),
            "github_owner": owner_login,
            "default_branch": repo.get("default_branch"),
            "private": repo.get("private", False),
            "fork": repo.get("fork", False),
            "html_url": repo.get("html_url"),
        },
    )

    counts = {"commits": 0, "pulls": 0, "issues": 0, "docs": 0, "people": 0}

    # ── Commits ─────────────────────────────────────────────────────────
    seen_logins: set[str] = set()
    commit_count = 0
    try:
        async for c in gh.list_commits(full_name):
            if commit_count >= MAX_COMMITS_PER_REPO:
                break
            sha = c.get("sha")
            commit = c.get("commit", {})
            author_actor = c.get("author") or {}
            author_meta = commit.get("author") or {}
            occurred_at = _parse_dt(author_meta.get("date")) or _parse_dt(c.get("commit", {}).get("committer", {}).get("date"))
            if not occurred_at:
                continue
            person_id = await _upsert_github_person(conn, workspace_id, author_actor)
            if author_actor.get("login") and author_actor["login"] not in seen_logins:
                seen_logins.add(author_actor["login"])
                counts["people"] += 1
            event_id = await graph_repo.upsert_event(
                conn,
                workspace_id,
                source="github",
                source_kind="commit",
                source_id=f"{full_name}@{sha}",
                occurred_at=occurred_at,
                venture_id=venture_id,
                title=(commit.get("message") or "")[:200],
                author_person_id=person_id,
                payload={
                    "sha": sha,
                    "url": c.get("html_url"),
                    "stats": c.get("stats"),
                    "author_login": author_actor.get("login"),
                    "author_name": author_meta.get("name"),
                    "author_email": author_meta.get("email"),
                },
            )
            if person_id and event_id:
                await graph_repo.add_edge(
                    conn, workspace_id, "participates_in",
                    "person", person_id, "event", event_id,
                )
            commit_count += 1
        counts["commits"] = commit_count
    except GitHubError as e:
        log.warning("github_sync_commits_failed", repo=full_name, error=str(e))

    # ── Issues + Pulls (in one /issues call — includes PRs) ────────────
    # We do /issues (includes PRs) for body + author, then /pulls only if
    # we need PR-specific metadata. Keep it simple: just hit /issues.
    issue_bodies: list[tuple[str, dict, str]] = []  # (gtask_id, issue, body)

    try:
        issue_count = 0
        async for issue in gh.list_issues(full_name):
            if issue_count >= MAX_ISSUES_PER_REPO + MAX_PULLS_PER_REPO:
                break
            is_pr = "pull_request" in issue
            kind = "pull_request" if is_pr else "issue"
            number = issue.get("number")
            source_id = f"{full_name}#{number}"
            author = issue.get("user") or {}
            person_id = await _upsert_github_person(conn, workspace_id, author)
            if author.get("login") and author["login"] not in seen_logins:
                seen_logins.add(author["login"])
                counts["people"] += 1
            status = issue.get("state")  # 'open' or 'closed'
            gtask_id = await graph_repo.upsert_graph_task(
                conn,
                workspace_id,
                source="github",
                source_kind=kind,
                source_id=source_id,
                title=(issue.get("title") or f"#{number}")[:200],
                venture_id=venture_id,
                body=issue.get("body"),
                status=status,
                assignee_person_id=None,  # could resolve from assignees array, but skip in v1
                source_url=issue.get("html_url"),
                source_created_at=_parse_dt(issue.get("created_at")),
                source_updated_at=_parse_dt(issue.get("updated_at")),
                completed_at=_parse_dt(issue.get("closed_at")),
                metadata={
                    "number": number,
                    "labels": [l.get("name") for l in (issue.get("labels") or [])],
                    "is_pr": is_pr,
                    "author_login": author.get("login"),
                },
            )
            if person_id and gtask_id:
                await graph_repo.add_edge(
                    conn, workspace_id, "authored_by",
                    "graph_task", gtask_id, "person", person_id,
                )
            if is_pr:
                counts["pulls"] += 1
            else:
                counts["issues"] += 1
            issue_count += 1
            body_text = issue.get("body") or ""
            if body_text.strip():
                issue_bodies.append((gtask_id, issue, body_text))
    except GitHubError as e:
        log.warning("github_sync_issues_failed", repo=full_name, error=str(e))

    # ── Embed bodies in batches ─────────────────────────────────────────
    if issue_bodies:
        BATCH = 16
        for i in range(0, len(issue_bodies), BATCH):
            chunk = issue_bodies[i : i + BATCH]
            texts = [(t.get("title") or "") + "\n\n" + body for (_, t, body) in chunk]
            try:
                vectors = await embed_batch(texts)
            except Exception as e:
                log.warning("embed_batch_failed", repo=full_name, error=str(e))
                continue
            for (gtask_id, issue, body), vec in zip(chunk, vectors):
                number = issue.get("number")
                is_pr = "pull_request" in issue
                kind = "pull_request" if is_pr else "issue"
                source_id = f"{full_name}#{number}"
                doc_id = await graph_repo.upsert_doc(
                    conn,
                    workspace_id,
                    source="github",
                    source_kind=kind,
                    source_id=source_id,
                    venture_id=venture_id,
                    title=issue.get("title"),
                    body=body,
                    source_url=issue.get("html_url"),
                    embedding=vec,
                    source_created_at=_parse_dt(issue.get("created_at")),
                    source_updated_at=_parse_dt(issue.get("updated_at")),
                    metadata={"number": number, "is_pr": is_pr},
                )
                # Edge: graph_task derived_from doc (the body)
                if gtask_id and doc_id:
                    await graph_repo.add_edge(
                        conn, workspace_id, "derived_from",
                        "graph_task", gtask_id, "doc", doc_id,
                    )
                counts["docs"] += 1

    return counts


# ─── public entry point ────────────────────────────────────────────────────


async def run_initial_github_sync(
    *,
    workspace_id: str,
    user_id: str,
) -> dict:
    """
    Run the full initial sync for one GitHub OAuth connection.

    Idempotent: re-running is safe and just refreshes rows.
    Designed to be called from a Celery task OR from a FastAPI endpoint
    via BackgroundTasks for small workspaces.
    """
    pool = await get_pool()

    # 1) Pull the encrypted token + connection_id
    async with pool.acquire() as conn:
        connection = await graph_repo.get_oauth_connection(conn, user_id, "github")
        if not connection:
            raise RuntimeError("No active GitHub connection for this user")
        connection_id = str(connection["id"])
        access_token = decrypt_token(connection["access_token_encrypted"])

    # 2) Start a sync job row (separate connection so it commits even if main flow blows up)
    async with pool.acquire() as conn:
        job_id = await _start_sync_job(
            conn,
            connection_id=connection_id,
            workspace_id=workspace_id,
            provider="github",
        )

    totals = {"repos": 0, "commits": 0, "pulls": 0, "issues": 0, "docs": 0, "people": 0}
    error: Optional[str] = None

    try:
        async with GitHubClient(access_token) as gh:
            repos: list[dict] = []
            async for r in gh.list_repos():
                if len(repos) >= MAX_REPOS:
                    break
                repos.append(r)

            async with pool.acquire() as conn:
                await _update_sync_job(
                    conn, job_id, phase="repos", progress={"discovered": len(repos)},
                )

            for idx, repo in enumerate(repos):
                async with pool.acquire() as conn:
                    async with conn.transaction():
                        counts = await _sync_repo(conn, gh, workspace_id, repo)
                totals["repos"] += 1
                for k, v in counts.items():
                    totals[k] = totals.get(k, 0) + v
                async with pool.acquire() as conn:
                    await _update_sync_job(
                        conn,
                        job_id,
                        phase=f"repo:{repo['full_name']}",
                        progress={**totals, "current": idx + 1, "total": len(repos)},
                    )
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        log.error("github_initial_sync_failed", error=error)

    async with pool.acquire() as conn:
        await _update_sync_job(
            conn,
            job_id,
            status="failed" if error else "completed",
            error=error,
            progress=totals,
        )

    log.info(
        "github_initial_sync_done",
        workspace_id=workspace_id,
        user_id=user_id,
        totals=totals,
        error=error,
    )
    return {"job_id": job_id, "totals": totals, "error": error}
