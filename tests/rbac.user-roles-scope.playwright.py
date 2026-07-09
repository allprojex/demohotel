"""
Regression E2E for the user_roles_admin_manage policy (finding
user_roles_admin_manage_property_scope).

Verifies, against a live database, that a property-level admin
(hotel_owner at Property A):

  ALLOWED
    - Insert a non-privileged role (front_desk) for another user at Property A
    - Update / delete that same row

  BLOCKED (Postgres RLS returns 401/403/42501)
    - Insert any role at Property B (cross-property)
    - Insert super_admin at Property A (privilege escalation)
    - Insert hotel_owner at Property A (privilege escalation)
    - Update a Property B role row (cross-property tampering)
    - Delete a Property B role row (cross-property tampering)

Requires:
  - Dev server running at http://localhost:8080
  - TEST_HARNESS_SECRET env var
Run:
  TEST_HARNESS_SECRET=... python3 tests/rbac.user-roles-scope.playwright.py
"""
import asyncio, json, os, sys, urllib.request, urllib.error
from pathlib import Path

APP = "http://localhost:8080"

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

HARNESS_SECRET = os.environ.get("TEST_HARNESS_SECRET")
if not HARNESS_SECRET:
    print("ERROR: TEST_HARNESS_SECRET not set", file=sys.stderr); sys.exit(2)

def http_json(url, body=None, headers=None, method="POST"):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
        headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()}

def harness(action, **kwargs):
    return http_json(f"{APP}/api/public/test/rbac-harness",
        {"action": action, **kwargs},
        headers={"x-harness-secret": HARNESS_SECRET})

def login(email, password):
    st, body = http_json(f"{SUPA_URL}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        headers={"apikey": SUPA_KEY, "authorization": f"Bearer {SUPA_KEY}"})
    if st != 200: raise RuntimeError(f"login {email}: {st} {body}")
    return body

def rest(method, path, token, body=None, extra_headers=None):
    hdr = {
        "apikey": SUPA_KEY,
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
        "prefer": "return=representation",
        **(extra_headers or {}),
    }
    return http_json(f"{SUPA_URL}/rest/v1{path}", body=body, headers=hdr, method=method)

def expect_ok(label, status, body):
    ok = 200 <= status < 300
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}  status={status}")
    if not ok: print(f"       body={body}")
    return ok

def expect_denied(label, status, body):
    # Postgres RLS denials come back as 401/403 with code 42501 or empty result
    denied = status in (401, 403) or (status == 404 and "0 rows" in json.dumps(body)) or \
             (isinstance(body, dict) and body.get("code") == "42501")
    print(f"  [{'PASS' if denied else 'FAIL'}] {label}  status={status}")
    if not denied: print(f"       body={body}")
    return denied

async def main():
    print("→ harness setup")
    st, setup = harness("setup")
    if st != 200: print(setup, file=sys.stderr); sys.exit(1)
    prop_a, prop_b = setup["propertyA"], setup["propertyB"]

    # Actor: hotel_owner scoped to Property A (should manage A-only, no privileged roles)
    actor_email = "rbac-owner-a@rbac.test"
    victim_a_email = "rbac-victim-a@rbac.test"
    victim_b_email = "rbac-victim-b@rbac.test"
    pw = "Harness!Passw0rd-Test"

    print("→ ensureUser: hotel_owner @ A")
    st, r = harness("ensureUser", email=actor_email, password=pw,
        roles=[{"role": "hotel_owner", "property_id": prop_a}])
    if st != 200: print(r, file=sys.stderr); sys.exit(1)
    actor_id = r["userId"]

    print("→ ensureUser: victim with role at A (front_desk)")
    st, r = harness("ensureUser", email=victim_a_email, password=pw,
        roles=[{"role": "front_desk", "property_id": prop_a}])
    if st != 200: print(r, file=sys.stderr); sys.exit(1)
    victim_a_id = r["userId"]

    print("→ ensureUser: victim with role at B (front_desk)")
    st, r = harness("ensureUser", email=victim_b_email, password=pw,
        roles=[{"role": "front_desk", "property_id": prop_b}])
    if st != 200: print(r, file=sys.stderr); sys.exit(1)
    victim_b_id = r["userId"]

    actor_token = login(actor_email, pw)["access_token"]

    # Find the seeded role rows so we can test update/delete
    st, rows_a = rest("GET",
        f"/user_roles?user_id=eq.{victim_a_id}&property_id=eq.{prop_a}&role=eq.front_desk",
        actor_token)
    st, rows_b = rest("GET",
        f"/user_roles?user_id=eq.{victim_b_id}&property_id=eq.{prop_b}&role=eq.front_desk",
        actor_token)
    # rows_b may be empty for actor (RLS may hide it); harness selected via service role earlier,
    # so we can still try to update by (user_id, role, property_id) filter.

    passes, fails = 0, 0
    def check(ok):
        nonlocal passes, fails
        passes += 1 if ok else 0
        fails += 0 if ok else 1

    print("\n=== ALLOWED operations (hotel_owner @ A, non-privileged, in-scope) ===")

    # Insert housekeeping at A for victim_a  → allowed
    st, body = rest("POST", "/user_roles", actor_token,
        body={"user_id": victim_a_id, "role": "housekeeping", "property_id": prop_a})
    check(expect_ok("insert housekeeping @ A for victim_a", st, body))

    # Update the existing front_desk row (memo-style: re-set same role) → allowed
    st, body = rest("PATCH",
        f"/user_roles?user_id=eq.{victim_a_id}&property_id=eq.{prop_a}&role=eq.front_desk",
        actor_token, body={"role": "front_desk"})
    check(expect_ok("update front_desk @ A for victim_a", st, body))

    # Delete the housekeeping row we just made → allowed
    st, body = rest("DELETE",
        f"/user_roles?user_id=eq.{victim_a_id}&property_id=eq.{prop_a}&role=eq.housekeeping",
        actor_token)
    check(expect_ok("delete housekeeping @ A for victim_a", st, body))

    print("\n=== BLOCKED operations (must be denied by RLS) ===")

    # Cross-property: insert role at B
    st, body = rest("POST", "/user_roles", actor_token,
        body={"user_id": victim_b_id, "role": "front_desk", "property_id": prop_b})
    check(expect_denied("insert front_desk @ B (cross-property)", st, body))

    # Privilege escalation: super_admin at A
    st, body = rest("POST", "/user_roles", actor_token,
        body={"user_id": actor_id, "role": "super_admin", "property_id": prop_a})
    check(expect_denied("insert super_admin @ A (privilege escalation)", st, body))

    # Privilege escalation: hotel_owner at A for someone else
    st, body = rest("POST", "/user_roles", actor_token,
        body={"user_id": victim_a_id, "role": "hotel_owner", "property_id": prop_a})
    check(expect_denied("insert hotel_owner @ A (privilege escalation)", st, body))

    # Cross-property: update role at B
    st, body = rest("PATCH",
        f"/user_roles?user_id=eq.{victim_b_id}&property_id=eq.{prop_b}&role=eq.front_desk",
        actor_token, body={"role": "housekeeping"})
    # PATCH with 0 affected rows returns 200 [] under RLS; treat that as denied too
    denied = (st in (401, 403)) or (200 <= st < 300 and body in ([], {}, None))
    print(f"  [{'PASS' if denied else 'FAIL'}] update front_desk @ B (cross-property)  status={st}")
    if not denied: print(f"       body={body}")
    check(denied)

    # Cross-property: delete role at B
    st, body = rest("DELETE",
        f"/user_roles?user_id=eq.{victim_b_id}&property_id=eq.{prop_b}&role=eq.front_desk",
        actor_token)
    denied = (st in (401, 403)) or (200 <= st < 300 and body in ([], {}, None))
    print(f"  [{'PASS' if denied else 'FAIL'}] delete front_desk @ B (cross-property)  status={st}")
    if not denied: print(f"       body={body}")
    check(denied)

    # Verify no B rows were actually modified (using harness cleanup would nuke them; re-read via actor first)
    # Actor can't see B rows, so use another login via harness: super_admin isn't available here,
    # but the fact that DELETE/PATCH returned empty is the proof under return=representation.

    print("\n→ harness cleanup")
    harness("cleanup")

    total = passes + fails
    print(f"\n=== user_roles scope regression: {passes}/{total} passed ===")
    sys.exit(0 if fails == 0 else 1)

asyncio.run(main())
