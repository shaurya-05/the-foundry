"""
THE FOUND3RY — Parallel Load Test
Simulates real concurrent users hammering the API simultaneously.
Creates users upfront, then blasts parallel requests.
"""

import asyncio
import aiohttp
import json
import time
import random
import string
import sys

BASE = "http://localhost:8000"

# ─── Config ───────────────────────────────────────────────────────────────────
NUM_USERS = 50
REQUESTS_PER_USER = 20
MAX_CONCURRENT = 100  # Max simultaneous connections

# ─── Helpers ──────────────────────────────────────────────────────────────────

def rand(n=6):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))

async def req(session, method, url, **kwargs):
    start = time.perf_counter()
    try:
        async with getattr(session, method)(url, **kwargs) as resp:
            body = await resp.text()
            ms = (time.perf_counter() - start) * 1000
            try:
                data = json.loads(body)
            except:
                data = {}
            return resp.status, data, ms
    except Exception as e:
        return 0, {"error": str(e)[:80]}, (time.perf_counter() - start) * 1000

# ─── Phase 1: Create Users ──────────────────────────────────────────────────

async def create_users(session):
    """Create test users one at a time with delays to avoid rate limiting."""
    print(f"\n👤 Creating {NUM_USERS} test users...")
    users = []
    for i in range(NUM_USERS):
        email = f"load_{rand(8)}@test.dev"
        password = "LoadTest123!"
        status, data, ms = await req(session, "post", f"{BASE}/api/auth/register",
            json={"email": email, "password": password, "display_name": f"Bot{i}"})
        if status == 200 and "access_token" in data:
            users.append({
                "email": email,
                "password": password,
                "token": data["access_token"],
                "workspace_id": data.get("workspace_id", ""),
            })
            if (i + 1) % 10 == 0:
                print(f"  Created {i+1}/{NUM_USERS} users")
        elif status == 429:
            print(f"  Rate limited at user {i+1}, waiting 10s...")
            await asyncio.sleep(10)
            # Retry
            status, data, ms = await req(session, "post", f"{BASE}/api/auth/register",
                json={"email": email, "password": password, "display_name": f"Bot{i}"})
            if status == 200 and "access_token" in data:
                users.append({
                    "email": email,
                    "password": password,
                    "token": data["access_token"],
                    "workspace_id": data.get("workspace_id", ""),
                })
        else:
            print(f"  Failed to create user {i+1}: status={status}")

        # Small delay every 4 users to stay under rate limit (5/min)
        if (i + 1) % 4 == 0:
            await asyncio.sleep(1)

    print(f"  ✅ Created {len(users)} users")
    return users

# ─── Phase 2: Seed Data ─────────────────────────────────────────────────────

async def seed_data(session, users):
    """Give each user some data to work with."""
    print(f"\n📦 Seeding data for {len(users)} users...")

    async def seed_user(user):
        h = {"Authorization": f"Bearer {user['token']}"}
        # Create a project
        await req(session, "post", f"{BASE}/api/projects", headers=h,
            json={"title": f"Project {rand()}"})
        # Create a task
        await req(session, "post", f"{BASE}/api/tasks", headers=h,
            json={"title": f"Task {rand()}", "status": "backlog"})
        # Create knowledge
        await req(session, "post", f"{BASE}/api/knowledge", headers=h,
            json={"title": f"Doc {rand()}", "content": f"Test content {rand(50)}", "type": "note"})

    # Seed in batches of 10
    for i in range(0, len(users), 10):
        batch = users[i:i+10]
        await asyncio.gather(*[seed_user(u) for u in batch])
        if (i + 10) % 20 == 0:
            print(f"  Seeded {min(i+10, len(users))}/{len(users)} users")

    print(f"  ✅ Data seeded")

# ─── Phase 3: Parallel Load Blast ────────────────────────────────────────────

async def load_blast(session, users):
    """Simulate all users hitting the API simultaneously."""
    total_users = len(users)
    total_reqs = total_users * REQUESTS_PER_USER
    print(f"\n🔥 LOAD BLAST: {total_users} users × {REQUESTS_PER_USER} requests = {total_reqs} total")
    print(f"   Max concurrent connections: {MAX_CONCURRENT}")

    # Endpoints each user will hit (weighted by typical usage)
    endpoints = [
        ("get", "/api/projects", 3),        # Most common
        ("get", "/api/tasks", 3),
        ("get", "/api/knowledge", 2),
        ("get", "/api/ideas", 2),
        ("get", "/api/auth/me", 2),
        ("get", "/api/notifications", 1),
        ("get", "/api/subscription", 1),
        ("get", "/api/context/timeline?limit=10", 1),
        ("get", "/api/workspace/members", 1),
        ("post", "/api/tasks", 1),           # Writes are less common
        ("post", "/api/projects", 1),
    ]

    # Build weighted endpoint list
    weighted = []
    for method, path, weight in endpoints:
        weighted.extend([(method, path)] * weight)

    results = []
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def single_request(user_idx):
        user = users[user_idx % total_users]
        h = {"Authorization": f"Bearer {user['token']}"}
        method, path = random.choice(weighted)

        # Add body for POST requests
        kwargs = {"headers": h}
        if method == "post" and "tasks" in path:
            kwargs["json"] = {"title": f"Task {rand()}", "status": "backlog"}
        elif method == "post" and "projects" in path:
            kwargs["json"] = {"title": f"Proj {rand()}"}

        async with semaphore:
            status, _, ms = await req(session, method, f"{BASE}{path}", **kwargs)
            return (status, ms, method, path)

    # Fire all requests
    start = time.perf_counter()
    tasks = [single_request(i) for i in range(total_reqs)]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    total_time = time.perf_counter() - start

    # Parse results
    for r in raw_results:
        if isinstance(r, Exception):
            results.append((0, 0, "?", "?"))
        else:
            results.append(r)

    return results, total_time

# ─── Phase 4: Sustained Load ────────────────────────────────────────────────

async def sustained_load(session, users):
    """30-second sustained load — continuous requests."""
    duration_seconds = 30
    total_users = len(users)
    print(f"\n⏱️  SUSTAINED LOAD: {total_users} users for {duration_seconds}s")

    results = []
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    stop_event = asyncio.Event()

    async def user_loop(user_idx):
        user = users[user_idx % total_users]
        h = {"Authorization": f"Bearer {user['token']}"}
        endpoints = ["/api/projects", "/api/tasks", "/api/knowledge", "/api/auth/me"]
        local_results = []

        while not stop_event.is_set():
            path = random.choice(endpoints)
            async with semaphore:
                status, _, ms = await req(session, "get", f"{BASE}{path}", headers=h)
                local_results.append((status, ms))
            await asyncio.sleep(random.uniform(0.05, 0.2))  # Realistic think time

        return local_results

    # Run for duration_seconds
    start = time.perf_counter()
    tasks = [asyncio.create_task(user_loop(i)) for i in range(min(total_users, 30))]

    await asyncio.sleep(duration_seconds)
    stop_event.set()

    all_results = await asyncio.gather(*tasks)
    total_time = time.perf_counter() - start

    for user_results in all_results:
        results.extend(user_results)

    return results, total_time

# ─── Analysis ────────────────────────────────────────────────────────────────

def analyze(results, total_time, label):
    total = len(results)
    if total == 0:
        print(f"  No results for {label}")
        return

    statuses = [r[0] for r in results]
    latencies = [r[1] for r in results if r[1] > 0]

    success = sum(1 for s in statuses if 200 <= s < 400)
    client_err = sum(1 for s in statuses if 400 <= s < 500)
    server_err = sum(1 for s in statuses if s >= 500)
    conn_err = sum(1 for s in statuses if s == 0)
    rate_limited = sum(1 for s in statuses if s == 429)

    avg_ms = sum(latencies) / max(len(latencies), 1)
    sorted_lat = sorted(latencies)
    p50 = sorted_lat[int(len(sorted_lat) * 0.50)] if sorted_lat else 0
    p95 = sorted_lat[int(len(sorted_lat) * 0.95)] if sorted_lat else 0
    p99 = sorted_lat[int(len(sorted_lat) * 0.99)] if sorted_lat else 0
    max_ms = max(latencies) if latencies else 0
    rps = total / total_time if total_time > 0 else 0

    # Status distribution
    status_counts = {}
    for s in statuses:
        status_counts[s] = status_counts.get(s, 0) + 1

    print(f"\n  {'='*60}")
    print(f"  📊 {label}")
    print(f"  {'='*60}")
    print(f"  Total requests:     {total}")
    print(f"  Duration:           {total_time:.1f}s")
    print(f"  Throughput:         {rps:.1f} req/s")
    print(f"  ")
    print(f"  ✅ Success (2xx):    {success} ({success/total*100:.1f}%)")
    print(f"  ⚠️  Client err (4xx): {client_err} ({client_err/total*100:.1f}%)")
    print(f"  ❌ Server err (5xx): {server_err} ({server_err/total*100:.1f}%)")
    print(f"  💀 Connection err:   {conn_err} ({conn_err/total*100:.1f}%)")
    print(f"  🚦 Rate limited:     {rate_limited}")
    print(f"  ")
    print(f"  Latency:")
    print(f"    avg:  {avg_ms:.0f}ms")
    print(f"    p50:  {p50:.0f}ms")
    print(f"    p95:  {p95:.0f}ms")
    print(f"    p99:  {p99:.0f}ms")
    print(f"    max:  {max_ms:.0f}ms")
    print(f"  ")
    print(f"  Status codes: {dict(sorted(status_counts.items()))}")

    # Verdict
    error_rate = (server_err + conn_err) / total * 100
    if error_rate == 0:
        print(f"\n  🟢 VERDICT: PASSED — Zero errors under load")
    elif error_rate < 1:
        print(f"\n  🟡 VERDICT: ACCEPTABLE — {error_rate:.2f}% error rate")
    else:
        print(f"\n  🔴 VERDICT: NEEDS WORK — {error_rate:.2f}% error rate")

    return error_rate

# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  THE FOUND3RY — Parallel Load Test")
    print(f"  Target: {BASE}")
    print(f"  Users: {NUM_USERS} | Requests/user: {REQUESTS_PER_USER}")
    print(f"  Max concurrent: {MAX_CONCURRENT}")
    print("=" * 60)

    # Check health
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT, limit_per_host=MAX_CONCURRENT)
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        status, _, _ = await req(session, "get", f"{BASE}/health")
        if status == 0:
            print(f"\n❌ Cannot connect to {BASE}. Start the backend first.")
            return

        # Phase 1: Create users
        users = await create_users(session)
        if len(users) < 5:
            print(f"\n❌ Only created {len(users)} users. Need at least 5.")
            return

        # Phase 2: Seed data
        await seed_data(session, users)

        # Phase 3: Load blast
        blast_results, blast_time = await load_blast(session, users)
        blast_error = analyze(blast_results, blast_time, f"LOAD BLAST ({len(users)} users × {REQUESTS_PER_USER} req)")

        # Phase 4: Sustained load
        sustained_results, sustained_time = await sustained_load(session, users)
        sustained_error = analyze(sustained_results, sustained_time, f"SUSTAINED LOAD (30s)")

        # Final verdict
        print(f"\n{'='*60}")
        if blast_error == 0 and sustained_error == 0:
            print(f"  🟢 ALL TESTS PASSED — Ready for production traffic")
        elif blast_error < 1 and sustained_error < 1:
            print(f"  🟡 ACCEPTABLE — Minor errors under extreme load")
        else:
            print(f"  🔴 NEEDS OPTIMIZATION — Errors detected under load")
        print(f"{'='*60}")

if __name__ == "__main__":
    asyncio.run(main())
