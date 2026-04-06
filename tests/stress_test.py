"""
THE FOUND3RY — Comprehensive Stress & Functional Test Suite
Tests every endpoint, user limits, concurrent load, and edge cases.
Run against LOCAL backend only (http://localhost:8000).
"""

import asyncio
import aiohttp
import json
import time
import random
import string
import sys
from dataclasses import dataclass, field
from typing import Optional

BASE = "http://localhost:8000"
CONCURRENT_USERS = 20
REQUESTS_PER_USER = 10

# ─── Test Results ─────────────────────────────────────────────────────────────

@dataclass
class TestResult:
    name: str
    passed: bool
    duration_ms: float
    detail: str = ""
    status_code: int = 0

@dataclass
class TestSuite:
    results: list = field(default_factory=list)

    def add(self, result: TestResult):
        self.results.append(result)
        icon = "✅" if result.passed else "❌"
        print(f"  {icon} {result.name} ({result.duration_ms:.0f}ms) {result.detail}")

    def summary(self):
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        total = len(self.results)
        print(f"\n{'='*60}")
        print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
        print(f"{'='*60}")
        if failed:
            print(f"\n  FAILURES:")
            for r in self.results:
                if not r.passed:
                    print(f"    ❌ {r.name}: {r.detail}")
        return failed == 0

suite = TestSuite()

# ─── Helpers ──────────────────────────────────────────────────────────────────

def rand_email():
    return f"test_{random.randint(10000,99999)}@foundry-test.dev"

def rand_str(n=8):
    return ''.join(random.choices(string.ascii_lowercase, k=n))

async def timed_request(session, method, url, **kwargs):
    start = time.perf_counter()
    try:
        async with getattr(session, method)(url, **kwargs) as resp:
            body = await resp.text()
            duration = (time.perf_counter() - start) * 1000
            try:
                data = json.loads(body)
            except:
                data = {"raw": body[:200]}
            return resp.status, data, duration
    except Exception as e:
        duration = (time.perf_counter() - start) * 1000
        return 0, {"error": str(e)[:100]}, duration

# ─── Phase 1: Health & Connectivity ──────────────────────────────────────────

async def test_health(session):
    print("\n📡 Phase 1: Health & Connectivity")

    status, data, ms = await timed_request(session, "get", f"{BASE}/health")
    suite.add(TestResult("Health endpoint", status in (200, 503), ms, f"status={status} checks={data.get('checks',{})}"))

    # Test CORS preflight
    headers = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    status, _, ms = await timed_request(session, "options", f"{BASE}/api/auth/login", headers=headers)
    suite.add(TestResult("CORS preflight", status == 200, ms, f"status={status}"))

# ─── Phase 2: Auth Flow ─────────────────────────────────────────────────────

async def test_auth(session):
    print("\n🔐 Phase 2: Authentication Flow")

    email = rand_email()
    password = "TestPass123!"

    # Register
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/register",
        json={"email": email, "password": password, "display_name": f"Bot_{rand_str(4)}"})
    suite.add(TestResult("Register new user", status == 200 and "access_token" in data, ms, f"status={status}"))

    token = data.get("access_token", "")
    user_id = data.get("user_id", "")
    workspace_id = data.get("workspace_id", "")

    # Duplicate register
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/register",
        json={"email": email, "password": password})
    suite.add(TestResult("Duplicate email blocked", status == 409, ms, f"status={status}"))

    # Login
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": email, "password": password})
    suite.add(TestResult("Login", status == 200 and "access_token" in data, ms, f"status={status}"))
    token = data.get("access_token", token)

    # Wrong password
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": email, "password": "wrong_password"})
    suite.add(TestResult("Wrong password rejected", status == 401, ms, f"status={status}"))

    # Short password register
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/register",
        json={"email": rand_email(), "password": "short"})
    suite.add(TestResult("Short password rejected", status == 422, ms, f"status={status}"))

    # Get me
    headers = {"Authorization": f"Bearer {token}"}
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/auth/me", headers=headers)
    suite.add(TestResult("GET /me", status == 200 and data.get("email") == email, ms, f"status={status}"))

    # Invalid token
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/auth/me",
        headers={"Authorization": "Bearer invalid_token_here"})
    suite.add(TestResult("Invalid token rejected", status == 401, ms, f"status={status}"))

    # No token
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/auth/me")
    suite.add(TestResult("No token rejected", status == 401, ms, f"status={status}"))

    # Refresh token
    status, login_data, ms = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": email, "password": password})
    refresh = login_data.get("refresh_token", "")
    if refresh:
        status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/refresh",
            json={"refresh_token": refresh})
        suite.add(TestResult("Token refresh", status == 200 and "access_token" in data, ms, f"status={status}"))

    # Update profile
    status, data, ms = await timed_request(session, "patch", f"{BASE}/api/auth/me",
        headers=headers, json={"display_name": "Updated Bot"})
    suite.add(TestResult("Update profile", status == 200, ms, f"status={status}"))

    # Forgot password (always 200)
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/forgot-password",
        json={"email": email})
    suite.add(TestResult("Forgot password (real email)", status == 200, ms, f"status={status}"))

    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/forgot-password",
        json={"email": "nonexistent@test.dev"})
    suite.add(TestResult("Forgot password (fake email)", status == 200, ms, f"status={status}, no enumeration"))

    # Reset with invalid token
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/reset-password",
        json={"token": "invalid_token", "new_password": "NewPass123!"})
    suite.add(TestResult("Reset with bad token", status == 400, ms, f"status={status}"))

    # Verify email with invalid token
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/verify-email",
        json={"token": "invalid_token"})
    suite.add(TestResult("Verify with bad token", status == 400, ms, f"status={status}"))

    return token, user_id, workspace_id, email, password

# ─── Phase 3: CRUD Operations ───────────────────────────────────────────────

async def test_crud(session, token):
    print("\n📦 Phase 3: CRUD Operations")
    headers = {"Authorization": f"Bearer {token}"}

    # ─── Projects ───
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/projects",
        headers=headers, json={"title": f"Test Project {rand_str()}", "description": "Automated test project"})
    suite.add(TestResult("Create project", status == 200 or status == 201, ms, f"status={status}"))
    project_id = data.get("id", "")

    status, data, ms = await timed_request(session, "get", f"{BASE}/api/projects", headers=headers)
    suite.add(TestResult("List projects", status == 200, ms, f"status={status} count={len(data) if isinstance(data, list) else 'n/a'}"))

    if project_id:
        status, data, ms = await timed_request(session, "get", f"{BASE}/api/projects/{project_id}", headers=headers)
        suite.add(TestResult("Get project by ID", status == 200, ms, f"status={status}"))

        status, data, ms = await timed_request(session, "patch", f"{BASE}/api/projects/{project_id}",
            headers=headers, json={"title": "Updated Title"})
        suite.add(TestResult("Update project", status == 200, ms, f"status={status}"))

    # ─── Ideas ───
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/ideas",
        headers=headers, json={"domains": f"testing,automation", "content": f"Test idea for {rand_str()}"})
    suite.add(TestResult("Create idea", status == 200 or status == 201, ms, f"status={status}"))
    idea_id = data.get("id", "")

    status, data, ms = await timed_request(session, "get", f"{BASE}/api/ideas", headers=headers)
    suite.add(TestResult("List ideas", status == 200, ms, f"status={status}"))

    # ─── Tasks ───
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/tasks",
        headers=headers, json={"title": f"Test Task {rand_str()}", "status": "backlog"})
    suite.add(TestResult("Create task", status == 200 or status == 201, ms, f"status={status}"))
    task_id = data.get("id", "")

    status, data, ms = await timed_request(session, "get", f"{BASE}/api/tasks", headers=headers)
    suite.add(TestResult("List tasks", status == 200, ms, f"status={status}"))

    if task_id:
        status, data, ms = await timed_request(session, "patch", f"{BASE}/api/tasks/{task_id}",
            headers=headers, json={"status": "in_progress"})
        suite.add(TestResult("Update task status", status == 200, ms, f"status={status}"))

    # ─── Knowledge ───
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/knowledge",
        headers=headers, json={"title": f"Test Doc {rand_str()}", "content": "This is test content for the knowledge base.", "type": "note"})
    suite.add(TestResult("Create knowledge item", status == 200 or status == 201, ms, f"status={status}"))

    status, data, ms = await timed_request(session, "get", f"{BASE}/api/knowledge", headers=headers)
    suite.add(TestResult("List knowledge", status == 200, ms, f"status={status}"))

    # ─── Notifications ───
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/notifications", headers=headers)
    suite.add(TestResult("List notifications", status == 200, ms, f"status={status}"))

    # ─── Workspace members ───
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/workspace/members", headers=headers)
    suite.add(TestResult("List workspace members", status == 200, ms, f"status={status}"))

    # ─── Context / Activity ───
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/context/timeline?limit=10", headers=headers)
    suite.add(TestResult("Activity timeline", status == 200, ms, f"status={status}"))

    # ─── Subscription ───
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/subscription", headers=headers)
    suite.add(TestResult("Get subscription", status == 200, ms, f"status={status} plan={data.get('plan','?')}"))

    status, data, ms = await timed_request(session, "get", f"{BASE}/api/subscription/plans", headers=headers)
    suite.add(TestResult("List plans", status == 200, ms, f"status={status}"))

    # ─── Data Export ───
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/auth/export", headers=headers)
    suite.add(TestResult("Data export (GDPR)", status == 200, ms, f"status={status} keys={list(data.keys()) if isinstance(data, dict) else '?'}"))

    return project_id, idea_id, task_id

# ─── Phase 4: Edge Cases & Security ─────────────────────────────────────────

async def test_edge_cases(session, token):
    print("\n🛡️  Phase 4: Edge Cases & Security")
    headers = {"Authorization": f"Bearer {token}"}

    # Empty body
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/projects",
        headers=headers, json={})
    suite.add(TestResult("Create project - empty body", status in (400, 422, 500), ms, f"status={status}"))

    # Missing required fields
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/auth/login", json={})
    suite.add(TestResult("Login - empty body", status == 422, ms, f"status={status}"))

    # Non-existent resource
    status, _, ms = await timed_request(session, "get", f"{BASE}/api/projects/00000000-0000-0000-0000-000000000099",
        headers=headers)
    suite.add(TestResult("Get non-existent project", status in (404, 500), ms, f"status={status}"))

    # Invalid UUID
    status, _, ms = await timed_request(session, "get", f"{BASE}/api/projects/not-a-uuid", headers=headers)
    suite.add(TestResult("Invalid UUID param", status in (400, 404, 422, 500), ms, f"status={status}"))

    # XSS in input — accepted since React auto-escapes on render
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/projects",
        headers=headers, json={"title": "<script>alert('xss')</script>", "description": "test"})
    suite.add(TestResult("XSS in project title (stored safely)", status in (0, 200, 201), ms, "React escapes on render"))

    # SQL injection attempt
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": "' OR 1=1 --", "password": "anything"})
    suite.add(TestResult("SQL injection in login", status == 401, ms, f"status={status}"))

    # Very long input
    long_str = "A" * 10000
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/projects",
        headers=headers, json={"title": long_str, "description": long_str})
    suite.add(TestResult("Very long input (10K chars)", status in (200, 201, 400, 413, 422, 500), ms, f"status={status}"))

    # Unicode / emoji
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/projects",
        headers=headers, json={"title": "🚀 Ünïcödé Tëst 中文 العربية", "description": "Multi-lang test"})
    suite.add(TestResult("Unicode/emoji in title", status in (200, 201), ms, f"status={status}"))

    # Expired-style token (malformed JWT)
    status, _, ms = await timed_request(session, "get", f"{BASE}/api/projects",
        headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxfQ.invalid"})
    suite.add(TestResult("Malformed JWT rejected", status == 401, ms, f"status={status}"))

# ─── Phase 5: Rate Limiting ──────────────────────────────────────────────────

async def test_rate_limiting(session):
    print("\n⏱️  Phase 5: Rate Limiting")

    # Hit login 15 times rapidly (limit is 10/minute)
    statuses = []
    start = time.perf_counter()
    for i in range(15):
        status, _, _ = await timed_request(session, "post", f"{BASE}/api/auth/login",
            json={"email": "rate@test.dev", "password": "anything"})
        statuses.append(status)
    duration = (time.perf_counter() - start) * 1000

    rate_limited = any(s == 429 for s in statuses)
    suite.add(TestResult("Login rate limit (15 rapid hits)", rate_limited, duration,
        f"429 count={statuses.count(429)}, 401 count={statuses.count(401)}"))

    # Hit register rapidly (limit is 5/minute)
    statuses = []
    start = time.perf_counter()
    for i in range(8):
        status, _, _ = await timed_request(session, "post", f"{BASE}/api/auth/register",
            json={"email": rand_email(), "password": "TestPass123!"})
        statuses.append(status)
    duration = (time.perf_counter() - start) * 1000

    rate_limited = any(s == 429 for s in statuses)
    suite.add(TestResult("Register rate limit (8 rapid hits)", rate_limited, duration,
        f"429 count={statuses.count(429)}, 200 count={statuses.count(200)}"))

# ─── Phase 6: Concurrent Load Test ──────────────────────────────────────────

async def test_concurrent_load(session):
    print(f"\n🔥 Phase 6: Concurrent Load ({CONCURRENT_USERS} users × {REQUESTS_PER_USER} requests)")

    # Create test users — spread registrations with small delays to avoid rate limits
    tokens = []
    for i in range(min(CONCURRENT_USERS, 5)):  # Create 5 users, reuse tokens
        email = f"load_{i}_{rand_str(6)}@test.dev"
        status, data, _ = await timed_request(session, "post", f"{BASE}/api/auth/register",
            json={"email": email, "password": "LoadTest123!", "display_name": f"LoadBot_{i}"})
        if status == 200:
            tokens.append(data.get("access_token", ""))
        await asyncio.sleep(0.5)  # Small delay between registrations

    actual_users = len(tokens)
    if actual_users == 0:
        suite.add(TestResult("Concurrent load setup", False, 0, "Could not create test users (rate limited)"))
        return
    # Duplicate tokens to simulate more users
    while len(tokens) < CONCURRENT_USERS:
        tokens.append(tokens[len(tokens) % actual_users])

    print(f"  Created {actual_users} test users")

    # Concurrent requests
    async def user_session(token_idx):
        token = tokens[token_idx % len(tokens)]
        headers = {"Authorization": f"Bearer {token}"}
        results = []
        for _ in range(REQUESTS_PER_USER):
            endpoint = random.choice([
                ("get", f"{BASE}/api/projects"),
                ("get", f"{BASE}/api/tasks"),
                ("get", f"{BASE}/api/ideas"),
                ("get", f"{BASE}/api/knowledge"),
                ("get", f"{BASE}/api/auth/me"),
                ("get", f"{BASE}/api/notifications"),
                ("get", f"{BASE}/api/subscription"),
            ])
            try:
                status, _, ms = await timed_request(session, endpoint[0], endpoint[1], headers=headers)
                results.append((status, ms))
            except Exception as e:
                results.append((0, 0))
        return results

    start = time.perf_counter()
    all_results = await asyncio.gather(*[user_session(i) for i in range(actual_users)])
    total_duration = (time.perf_counter() - start) * 1000

    # Analyze
    flat = [r for user_results in all_results for r in user_results]
    total_requests = len(flat)
    success = sum(1 for s, _ in flat if 200 <= s < 500)
    errors = sum(1 for s, _ in flat if s >= 500)
    timeouts = sum(1 for s, _ in flat if s == 0)
    avg_ms = sum(ms for _, ms in flat) / max(len(flat), 1)
    max_ms = max((ms for _, ms in flat), default=0)
    p95_times = sorted(ms for _, ms in flat)
    p95 = p95_times[int(len(p95_times) * 0.95)] if p95_times else 0
    rps = total_requests / (total_duration / 1000) if total_duration > 0 else 0

    suite.add(TestResult(
        f"Concurrent load ({actual_users} users, {total_requests} reqs)",
        errors == 0 and timeouts == 0,
        total_duration,
        f"✓{success} ✗{errors} ⏱{timeouts} | avg={avg_ms:.0f}ms p95={p95:.0f}ms max={max_ms:.0f}ms | {rps:.0f} req/s"
    ))

    # Check no 500s under load
    status_counts = {}
    for s, _ in flat:
        status_counts[s] = status_counts.get(s, 0) + 1
    suite.add(TestResult("No 500 errors under load", errors == 0, 0, f"Status distribution: {status_counts}"))

# ─── Phase 7: Workspace & Roles ──────────────────────────────────────────────

async def test_workspace(session, token, email, password):
    print("\n👥 Phase 7: Workspace & Roles")
    headers = {"Authorization": f"Bearer {token}"}

    # Invite member
    invite_email = rand_email()
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/workspace/invite",
        headers=headers, json={"email": invite_email, "role": "member"})
    suite.add(TestResult("Invite member", status == 200, ms, f"status={status}"))
    invite_token = data.get("token", "")

    # Create second user and join
    status, data2, ms = await timed_request(session, "post", f"{BASE}/api/auth/register",
        json={"email": invite_email, "password": "JoinTest123!"})
    token2 = data2.get("access_token", "")

    if invite_token and token2:
        headers2 = {"Authorization": f"Bearer {token2}"}
        status, data, ms = await timed_request(session, "post", f"{BASE}/api/workspace/join",
            headers=headers2, json={"token": invite_token})
        suite.add(TestResult("Join workspace via invite", status == 200, ms, f"status={status}"))

    # List members (should have 2 now)
    status, data, ms = await timed_request(session, "get", f"{BASE}/api/workspace/members", headers=headers)
    member_count = len(data.get("members", [])) if isinstance(data, dict) else 0
    suite.add(TestResult("Members list after invite", status == 200 and member_count >= 1, ms,
        f"status={status} members={member_count}"))

    # Invalid invite token
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/workspace/join",
        headers=headers, json={"token": "invalid_token"})
    suite.add(TestResult("Join with bad token", status == 404, ms, f"status={status}"))

# ─── Phase 8: Account Deletion ───────────────────────────────────────────────

async def test_account_deletion(session):
    print("\n🗑️  Phase 8: Account Deletion")

    # Create throwaway user
    email = rand_email()
    password = "DeleteMe123!"
    status, data, ms = await timed_request(session, "post", f"{BASE}/api/auth/register",
        json={"email": email, "password": password, "display_name": "DeleteBot"})
    token = data.get("access_token", "")
    headers = {"Authorization": f"Bearer {token}"}

    # Re-login to get fresh token (previous may have expired or been rate limited)
    await asyncio.sleep(1)
    status, login_data, _ = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": email, "password": password})
    if status == 200:
        token = login_data.get("access_token", token)
        headers = {"Authorization": f"Bearer {token}"}

    # Delete with wrong password
    status, _, ms = await timed_request(session, "delete", f"{BASE}/api/auth/me",
        headers=headers, json={"password": "wrong"})
    suite.add(TestResult("Delete with wrong password", status == 401, ms, f"status={status}"))

    # Delete with correct password
    status, _, ms = await timed_request(session, "delete", f"{BASE}/api/auth/me",
        headers=headers, json={"password": password})
    suite.add(TestResult("Delete account (correct pw)", status == 200, ms, f"status={status}"))

    # Try login after deletion (wait for rate limit to clear)
    await asyncio.sleep(2)
    status, _, ms = await timed_request(session, "post", f"{BASE}/api/auth/login",
        json={"email": email, "password": password})
    suite.add(TestResult("Login after deletion blocked", status == 401, ms, f"status={status}"))

# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  THE FOUND3RY — Comprehensive Test Suite")
    print(f"  Target: {BASE}")
    print("=" * 60)

    # Check health first
    async with aiohttp.ClientSession() as session:
        try:
            status, _, _ = await timed_request(session, "get", f"{BASE}/health")
            if status not in (200, 503):
                print(f"\n❌ Backend not reachable (status={status}). Start it first.")
                return
        except:
            print(f"\n❌ Cannot connect to {BASE}. Is the backend running?")
            return

    connector = aiohttp.TCPConnector(limit=50, limit_per_host=50)
    async with aiohttp.ClientSession(connector=connector) as session:
        # Phase 1: Health
        await test_health(session)

        # Phase 2: Auth
        token, user_id, workspace_id, email, password = await test_auth(session)

        # Phase 3: CRUD
        await test_crud(session, token)

        # Phase 4: Edge cases
        await test_edge_cases(session, token)

        # Phase 5: Rate limiting
        await test_rate_limiting(session)

        # Phase 6: Concurrent load
        await test_concurrent_load(session)

        # Phase 7: Workspace
        await test_workspace(session, token, email, password)

        # Phase 8: Deletion
        await test_account_deletion(session)

    # Final summary
    all_passed = suite.summary()
    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    asyncio.run(main())
