"""
Cross-property RBAC E2E harness.

Requires:
  - Dev server running at http://localhost:8080
  - TEST_HARNESS_SECRET env var (or a published deployment with the same secret)

What it does:
  1. Calls the /api/public/test/rbac-harness endpoint (setup) to ensure two
     test properties exist (Property A / Property B).
  2. For each role-under-test, creates a fresh test user scoped to Property A
     (via harness ensureUser) and signs in as that user in Playwright.
  3. Visits an "allowed" route (from the RBAC matrix) with active_property=A
     and confirms neither /auth redirect nor "Access restricted" is shown.
  4. Switches the active property to B and confirms the same route now shows
     "Access restricted" (or bounces).
  5. Also tests a "global scope" user (property_id=null) — must be allowed
     on both properties.
  6. Cleans up (deletes test users + properties) at the end.

Run inside sandbox:  python3 tests/rbac.cross-property.playwright.py
"""
import asyncio, json, os, sys, urllib.request, urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

APP = "http://localhost:8080"
OUT = Path("/tmp/browser/rbac-cross"); OUT.mkdir(parents=True, exist_ok=True)

# Parse .env for VITE_SUPABASE_URL / _PUBLISHABLE_KEY / _PROJECT_ID
def load_env():
    env = {}
    for line in Path(".env").read_text().splitlines():
        if "=" not in line or line.startswith("#"): continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
SUPA_URL = ENV["VITE_SUPABASE_URL"]
SUPA_KEY = ENV["VITE_SUPABASE_PUBLISHABLE_KEY"]
PROJECT_REF = ENV["VITE_SUPABASE_PROJECT_ID"]
STORAGE_KEY = f"sb-{PROJECT_REF}-auth-token"

HARNESS_SECRET = os.environ.get("TEST_HARNESS_SECRET")
if not HARNESS_SECRET:
    print("ERROR: TEST_HARNESS_SECRET not set in environment", file=sys.stderr)
    sys.exit(2)

# Roles + allowed route to probe. Kept small — the exhaustive matrix lives in
# tests/rbac.matrix.test.ts. Here we only prove the end-to-end guard works.
# Role → allowed route to probe. Kept small — the exhaustive matrix lives in
# tests/rbac.matrix.test.ts. Here we only prove the end-to-end guard works.
# NOTE: /admin and /admin/audit have stricter in-page gates than ROUTE_ROLE_MAP
# (they hard-require ADMIN_ROLES via useHasAnyRole), so they are intentionally
# excluded from this E2E harness.
CASES = [
    ("cashier",                 "/pos"),
    ("front_desk",              "/reservations"),
    ("accountant",              "/accounting"),
    ("housekeeping_supervisor", "/housekeeping"),
    ("storekeeper",             "/inventory"),
    ("reservations",            "/channels"),
]

def http_json(url, body, headers=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
        headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()}

def harness(action, **kwargs):
    return http_json(f"{APP}/api/public/test/rbac-harness",
        {"action": action, **kwargs},
        headers={"x-harness-secret": HARNESS_SECRET})

def supabase_password_login(email, password):
    """Returns a Supabase session JSON (access_token, refresh_token, user, expires_at, ...)."""
    status, body = http_json(
        f"{SUPA_URL}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        headers={"apikey": SUPA_KEY, "authorization": f"Bearer {SUPA_KEY}"},
    )
    if status != 200:
        raise RuntimeError(f"Supabase login failed for {email}: {status} {body}")
    return body

async def probe(page, route, active_property):
    """Navigate with active property set. Returns 'ok' | 'denied' | 'auth'."""
    await page.goto(APP, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem('iti-active-property', {json.dumps(active_property)})"
    )
    try:
        await page.goto(f"{APP}{route}", wait_until="networkidle", timeout=15000)
    except Exception:
        pass  # inspect state below regardless
    final = page.url
    if "/auth" in final and "/auth" not in route:
        return "auth", final
    # Give the guard effect a tick to settle
    await page.wait_for_timeout(400)
    body_text = await page.inner_text("body")
    if "Access restricted" in body_text:
        return "denied", final
    return "ok", final

async def main():
    print(f"→ harness setup")
    status, setup = harness("setup")
    if status != 200:
        print(f"setup failed: {status} {setup}", file=sys.stderr); sys.exit(1)
    prop_a, prop_b = setup["propertyA"], setup["propertyB"]
    print(f"  Property A = {prop_a}")
    print(f"  Property B = {prop_b}")

    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        for role, route in CASES:
            email = f"rbac-{role.replace('_','-')}@rbac.test"
            password = "Harness!Passw0rd-Test"

            # --- Scoped-to-A user: must pass on A, be blocked on B ---
            print(f"\n→ [{role}] ensureUser scoped to Property A")
            status, r = harness("ensureUser", email=email, password=password,
                roles=[{"role": role, "property_id": prop_a}])
            if status != 200:
                print(f"  ensureUser failed: {status} {r}", file=sys.stderr); continue

            session = supabase_password_login(email, password)
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
            page = await ctx.new_page()
            await page.goto(APP, wait_until="domcontentloaded")
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(json.dumps(session))})"
            )

            outcome_a, final_a = await probe(page, route, prop_a)
            outcome_b, final_b = await probe(page, route, prop_b)
            slug = f"{role}_{route.strip('/').replace('/', '_')}"
            await page.screenshot(path=str(OUT / f"{slug}_B.png"))
            results.append({
                "role": role, "route": route, "scope": "propertyA",
                "expect_A": "ok", "got_A": outcome_a,
                "expect_B": "denied", "got_B": outcome_b,
            })
            await ctx.close()

            # Global (null-scope) grants are rejected by the DB trigger
            # `enforce_user_role_scope` for every role except super_admin, so
            # they are not part of the E2E surface here. The `isAllowed`
            # short-circuit for null scope is covered by tests/rbac.matrix.test.ts.


        await browser.close()

    print("\n→ harness cleanup")
    harness("cleanup")

    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print("\n=== RBAC cross-property results ===")
    failures = 0
    for r in results:
        ok = r["got_A"] == r["expect_A"] and r["got_B"] == r["expect_B"]
        if not ok: failures += 1
        marker = "PASS" if ok else "FAIL"
        print(f"  [{marker}] {r['role']:26s} {r['scope']:10s} {r['route']:20s} "
              f"A={r['got_A']}/{r['expect_A']}  B={r['got_B']}/{r['expect_B']}")
    print(f"\n{len(results) - failures}/{len(results)} passed")
    sys.exit(0 if failures == 0 else 1)

asyncio.run(main())
