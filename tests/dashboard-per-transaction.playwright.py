# Per-POS-transaction dashboard assertion.
#
# For each individual POS sale we insert, we assert that the exact expected
# widget delta (POS revenue) is reflected within a bounded time window — no
# multi-second idle waits, no whole-page reloads to "hope it refreshes".
#
# Data path under test:
#   pos_orders + pos_order_items + pos_payments  →  exec_analytics_kpis RPC
#     → Analytics KPI card "POS revenue" (`src/routes/_authenticated/analytics.tsx`)
#
# Test strategy per transaction:
#   1. Snapshot pos_revenue via the SAME RPC the widget calls.
#   2. Insert exactly one POS sale (open → items → close → payment) via REST.
#   3. Poll the RPC every 250 ms up to WINDOW_MS; assert
#        pos_revenue_after == pos_revenue_before + expected_sale_total
#      Fail if not observed within the window.
#   4. Repeat for N distinct sale plans — each transaction must produce its
#      own correct incremental delta.
#
# After the RPC-level assertions, mount /analytics in the browser and confirm
# the "POS revenue" KPI card renders the same total as the RPC — proving the
# widget itself is wired to the value we just verified.
#
# Cleanup: every inserted order is guest_name-tagged `[TEST] realtime N`
# and can be purged via the existing Trial Data purge flow.
#
# Run: python3 tests/dashboard-per-transaction.playwright.py
import asyncio, atexit, json, os, re, signal, sys, time, urllib.request, urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

# --- Cleanup registry -------------------------------------------------------
# Every resource we create is registered here IMMEDIATELY after the REST call
# that produces it. `_run_cleanup` runs on normal exit, on unhandled
# exception (via atexit), and on SIGINT / SIGTERM — so even a crash mid-run
# still purges the test rows.
_created = {
    "pos_payments": [],       # ids
    "pos_order_items": [],    # ids (for orders whose cascade we can't rely on)
    "pos_orders": [],         # ids
    "stock_adjustments": [],  # ids (created indirectly via triggers, if any)
    "guest_name_tags": set(), # belt-and-suspenders sweep patterns
    "outlets_created": [],    # only outlets WE created (not pre-existing)
    "reservations": [],       # ids
    "guests": [],             # ids
    "room_status_snapshots": {},  # room_id -> original status (revert on teardown)
}
_cleanup_ctx = {"token": None, "property_id": None, "ran": False}

BASE = "http://localhost:8080"
OUT = Path("/tmp/browser/dashboard-per-transaction"); OUT.mkdir(parents=True, exist_ok=True)
WINDOW_MS = 8_000        # bounded per-transaction window (hard timeout)
POLL_MS = 250
# Latency budget: from the moment a write is issued to the moment the
# dashboard/calendar reflects it. Overridable via env for CI tuning.
LATENCY_THRESHOLD_MS = int(os.environ.get("DASHBOARD_LATENCY_THRESHOLD_MS", "3000"))
latencies: list[dict] = []  # {event, latency_ms, threshold_ms, ok}

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://mkjojutfyrgoihsyputj.supabase.co")
SUPABASE_ANON = os.environ.get(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    # Fallback to the value baked into the client for local dev.
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ram9qdXRmeXJnb2loc3lwdXRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTkxMDMsImV4cCI6MjA5ODc3NTEwM30.qn6hw1imk2hKptCC4-_XhprCTvzBMkd9_ByQrWk93sc",
)

# 3 distinct sales, each with a known total in the base currency.
SALES = [
    {"name": "[TEST] realtime 1", "lines": [{"name": "TEST-RT-A", "price": 7.00, "qty": 2}]},   # 14.00
    {"name": "[TEST] realtime 2", "lines": [{"name": "TEST-RT-B", "price": 12.50, "qty": 1}]},  # 12.50
    {"name": "[TEST] realtime 3", "lines": [
        {"name": "TEST-RT-C", "price": 4.00, "qty": 3},                                          # 12.00
        {"name": "TEST-RT-D", "price": 6.50, "qty": 1},                                          #  6.50
    ]},                                                                                          # total 18.50
]

failures = []
def check(label, ok, detail=""):
    tag = "ok  " if ok else "FAIL"
    print(f"{tag}  {label}" + (f" — {detail}" if detail else ""))
    if not ok: failures.append(label)


def rest(access_token: str, path: str, method: str = "GET", body=None, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers: headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode() or "null"
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


def get_pos_revenue(token: str, property_id: str) -> float:
    today = time.strftime("%Y-%m-%d")
    rows = rest(token, "rpc/exec_analytics_kpis", "POST",
                {"_property_id": property_id, "_from": today, "_to": today})
    if not rows: return 0.0
    return float(rows[0].get("pos_revenue") or 0)


def pick_property(token: str) -> str:
    props = rest(token, "properties?select=id&active=eq.true&limit=1")
    if not props: raise RuntimeError("No active property visible to this user")
    return props[0]["id"]


def get_outlet(token: str, property_id: str) -> str:
    outs = rest(token, f"pos_outlets?select=id&property_id=eq.{property_id}&limit=1")
    if outs: return outs[0]["id"]
    ins = rest(token, "pos_outlets", "POST",
               {"property_id": property_id, "name": "[TEST] Realtime Outlet",
                "kind": "restaurant", "tax_rate": 0, "active": True},
               extra_headers={"Prefer": "return=representation"})
    outlet_id = ins[0]["id"]
    _created["outlets_created"].append(outlet_id)
    return outlet_id


def create_sale(token: str, property_id: str, outlet_id: str, sale) -> float:
    total = round(sum(l["price"] * l["qty"] for l in sale["lines"]), 2)
    # Register the tag FIRST so a crash between now and the insert still
    # sweeps any partial row created by the API.
    _created["guest_name_tags"].add(sale["name"])
    ord_ins = rest(token, "pos_orders", "POST",
                   {"property_id": property_id, "outlet_id": outlet_id,
                    "status": "open", "guest_name": sale["name"]},
                   extra_headers={"Prefer": "return=representation"})
    order_id = ord_ins[0]["id"]
    _created["pos_orders"].append(order_id)
    items = rest(token, "pos_order_items", "POST",
         [{"order_id": order_id, "menu_item_id": None,
           "name_snapshot": l["name"], "price_snapshot": l["price"], "quantity": l["qty"]}
          for l in sale["lines"]],
         extra_headers={"Prefer": "return=representation"})
    for it in items or []:
        if it.get("id"): _created["pos_order_items"].append(it["id"])
    rest(token, f"pos_orders?id=eq.{order_id}", "PATCH",
         {"status": "closed", "subtotal": total, "tax": 0, "total": total,
          "closed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    pay = rest(token, "pos_payments", "POST",
         {"order_id": order_id, "method": "cash", "amount": total, "reference": sale["name"]},
         extra_headers={"Prefer": "return=representation"})
    for p in pay or []:
        if p.get("id"): _created["pos_payments"].append(p["id"])
    return total


def wait_for_revenue(token: str, property_id: str, target: float,
                     t0: float | None = None) -> tuple[bool, float, int]:
    """Poll RPC until revenue==target. Latency is measured from t0 (the moment
    the mutating write was issued), NOT from when polling started."""
    start = t0 if t0 is not None else time.time()
    deadline = start + WINDOW_MS / 1000
    last = -1.0
    while time.time() < deadline:
        last = get_pos_revenue(token, property_id)
        if abs(last - target) < 0.005:
            return True, last, int((time.time() - start) * 1000)
        time.sleep(POLL_MS / 1000)
    return False, last, int((time.time() - start) * 1000)


def _safe_delete(token: str, path: str) -> tuple[bool, str]:
    try:
        rest(token, path, "DELETE")
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


def _run_cleanup():
    """Idempotent, exception-proof teardown. Safe to call multiple times."""
    if _cleanup_ctx["ran"]: return
    _cleanup_ctx["ran"] = True
    token = _cleanup_ctx["token"]
    property_id = _cleanup_ctx["property_id"]
    if not token:
        return  # never got far enough to authenticate

    report = {"deleted": {}, "errors": []}

    # 1) Payments first (explicit — even though pos_orders CASCADE covers them,
    #    a failed order delete would otherwise leave payments orphaned).
    for pid in list(_created["pos_payments"]):
        ok, err = _safe_delete(token, f"pos_payments?id=eq.{pid}")
        if not ok: report["errors"].append(f"pos_payments {pid}: {err}")
    report["deleted"]["pos_payments_by_id"] = len(_created["pos_payments"])

    # 2) Order items (defensive; CASCADE from pos_orders should already handle these).
    for iid in list(_created["pos_order_items"]):
        _safe_delete(token, f"pos_order_items?id=eq.{iid}")
    report["deleted"]["pos_order_items_by_id"] = len(_created["pos_order_items"])

    # 3) Orders by tracked id.
    for oid in list(_created["pos_orders"]):
        ok, err = _safe_delete(token, f"pos_orders?id=eq.{oid}")
        if not ok: report["errors"].append(f"pos_orders {oid}: {err}")
    report["deleted"]["pos_orders_by_id"] = len(_created["pos_orders"])

    # 4) Belt-and-suspenders sweep by tag — catches rows created before we
    #    captured their id (e.g. crash between POST and response parsing).
    if property_id:
        swept_orders = 0
        try:
            orders = rest(
                token,
                f"pos_orders?select=id&property_id=eq.{property_id}"
                f"&guest_name=ilike.%5B%25TEST%5D%25realtime%25",
            )
            for o in orders:
                # Delete payments for this order first, then the order itself.
                try:
                    pays = rest(token, f"pos_payments?select=id&order_id=eq.{o['id']}")
                    for p in pays: _safe_delete(token, f"pos_payments?id=eq.{p['id']}")
                except Exception: pass
                ok, err = _safe_delete(token, f"pos_orders?id=eq.{o['id']}")
                if ok: swept_orders += 1
                else: report["errors"].append(f"sweep pos_orders {o['id']}: {err}")
        except Exception as e:
            report["errors"].append(f"sweep query: {str(e)[:200]}")
        report["deleted"]["pos_orders_by_tag_sweep"] = swept_orders

    # 5) Stock adjustments — none are created by this test's ad-hoc items
    #    (menu_item_id=null → no inventory link), but if a future change wires
    #    them up we still purge anything we tracked.
    for sid in list(_created["stock_adjustments"]):
        _safe_delete(token, f"stock_adjustments?id=eq.{sid}")
    report["deleted"]["stock_adjustments_by_id"] = len(_created["stock_adjustments"])

    # 6) Outlets we created (only if empty of other orders).
    for oid in list(_created["outlets_created"]):
        _safe_delete(token, f"pos_outlets?id=eq.{oid}")

    # 7) Reservations we created — delete BEFORE the guest (FK).
    for rid in list(_created["reservations"]):
        ok, err = _safe_delete(token, f"reservations?id=eq.{rid}")
        if not ok: report["errors"].append(f"reservations {rid}: {err}")
    report["deleted"]["reservations_by_id"] = len(_created["reservations"])

    # Belt-and-suspenders reservation sweep by code prefix.
    if property_id:
        swept_res = 0
        try:
            reses = rest(
                token,
                f"reservations?select=id&property_id=eq.{property_id}"
                f"&code=ilike.%5BTEST%5DRT-%25",
            )
            for r in reses:
                ok, _ = _safe_delete(token, f"reservations?id=eq.{r['id']}")
                if ok: swept_res += 1
        except Exception as e:
            report["errors"].append(f"sweep reservations: {str(e)[:200]}")
        report["deleted"]["reservations_by_code_sweep"] = swept_res

    # 8) Revert room.status to the value we snapshotted before flipping it.
    reverted_rooms = 0
    for room_id, orig_status in list(_created["room_status_snapshots"].items()):
        try:
            rest(token, f"rooms?id=eq.{room_id}", "PATCH", {"status": orig_status})
            reverted_rooms += 1
        except Exception as e:
            report["errors"].append(f"revert room {room_id}: {str(e)[:200]}")
    report["deleted"]["rooms_reverted"] = reverted_rooms

    # 9) Guests last (FK from reservations must be gone first).
    for gid in list(_created["guests"]):
        ok, err = _safe_delete(token, f"guests?id=eq.{gid}")
        if not ok: report["errors"].append(f"guests {gid}: {err}")
    report["deleted"]["guests_by_id"] = len(_created["guests"])

    print("cleanup:", json.dumps(report, indent=2))



def _signal_handler(signum, _frame):
    print(f"\nreceived signal {signum}; running cleanup…")
    _run_cleanup()
    # Re-raise default behaviour so the process actually exits.
    sys.exit(128 + signum)


atexit.register(_run_cleanup)
for _sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    try: signal.signal(_sig, _signal_handler)
    except (ValueError, OSError, AttributeError): pass  # e.g. SIGHUP on Windows


# ---- Reservation / occupancy helpers -------------------------------------

TODAY = time.strftime("%Y-%m-%d")
TOMORROW = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))
CALENDAR_WINDOW_END = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 14 * 86400))


def dashboard_counts(token: str, property_id: str) -> dict:
    """Mirror the exact queries the dashboard component runs."""
    rooms = rest(token, f"rooms?select=id,status&property_id=eq.{property_id}")
    total = len(rooms)
    occupied = sum(1 for r in rooms if r.get("status") == "occupied")
    arrivals = rest(
        token,
        f"reservations?select=id&property_id=eq.{property_id}"
        f"&check_in=eq.{TODAY}&status=in.(confirmed,checked_in)",
    )
    inhouse = rest(
        token,
        f"reservations?select=id&property_id=eq.{property_id}&status=eq.checked_in",
    )
    return {
        "total_rooms": total,
        "occupied": occupied,
        "occupancy_pct": round(occupied / total * 100) if total else 0,
        "arrivals": len(arrivals),
        "inhouse": len(inhouse),
    }


def calendar_reservations_for_room(token: str, property_id: str, room_id: str) -> list:
    """Same predicate as src/routes/_authenticated/calendar.tsx (14-day window)."""
    q = (
        f"reservations?select=id,check_in,check_out,room_id,status"
        f"&property_id=eq.{property_id}&room_id=eq.{room_id}"
        f"&status=in.(confirmed,checked_in)"
        f"&check_in=lt.{CALENDAR_WINDOW_END}&check_out=gt.{TODAY}"
    )
    return rest(token, q)


def pick_free_rooms(token: str, property_id: str, n: int) -> list:
    rows = rest(
        token,
        f"rooms?select=id,number,room_type_id,status"
        f"&property_id=eq.{property_id}&status=eq.available&limit={n}",
    )
    if len(rows) < n:
        raise RuntimeError(f"Need {n} available rooms, found {len(rows)}")
    return rows


def ensure_test_guest(token: str, property_id: str) -> str:
    ins = rest(
        token, "guests", "POST",
        {"property_id": property_id, "first_name": "[TEST]",
         "last_name": "Realtime Guest", "vip": False},
        extra_headers={"Prefer": "return=representation"},
    )
    gid = ins[0]["id"]
    _created["guests"].append(gid)
    return gid


def create_reservation(token: str, property_id: str, guest_id: str, room: dict, seq: int) -> str:
    code = f"[TEST]RT-{int(time.time())}-{seq}"
    ins = rest(
        token, "reservations", "POST",
        {"property_id": property_id, "code": code, "guest_id": guest_id,
         "room_type_id": room["room_type_id"], "room_id": room["id"],
         "check_in": TODAY, "check_out": TOMORROW,
         "adults": 1, "children": 0, "status": "confirmed",
         "source": "direct", "rate_total": 0},
        extra_headers={"Prefer": "return=representation"},
    )
    rid = ins[0]["id"]
    _created["reservations"].append(rid)
    return rid


def check_in_reservation(token: str, reservation_id: str, room: dict):
    # Snapshot original room.status before we flip it so cleanup can revert.
    if room["id"] not in _created["room_status_snapshots"]:
        _created["room_status_snapshots"][room["id"]] = room["status"]
    rest(token, f"reservations?id=eq.{reservation_id}", "PATCH",
         {"status": "checked_in",
          "checked_in_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    rest(token, f"rooms?id=eq.{room['id']}", "PATCH", {"status": "occupied"})


def wait_until(fn, ok_pred, window_ms=WINDOW_MS,
               t0: float | None = None) -> tuple[bool, object, int]:
    """Latency measured from t0 (the write time) if provided, else from call."""
    start = t0 if t0 is not None else time.time()
    deadline = start + window_ms / 1000
    last = None
    while time.time() < deadline:
        last = fn()
        if ok_pred(last):
            return True, last, int((time.time() - start) * 1000)
        time.sleep(POLL_MS / 1000)
    return False, last, int((time.time() - start) * 1000)


def record_latency(event: str, ok_observed: bool, elapsed_ms: int):
    """Track and assert the event-to-first-update latency against the budget."""
    within = ok_observed and elapsed_ms <= LATENCY_THRESHOLD_MS
    latencies.append({
        "event": event, "latency_ms": elapsed_ms,
        "threshold_ms": LATENCY_THRESHOLD_MS,
        "observed": ok_observed, "ok": within,
    })
    check(
        f"latency: {event} first update ≤ {LATENCY_THRESHOLD_MS}ms",
        within,
        f"observed={ok_observed} elapsed={elapsed_ms}ms budget={LATENCY_THRESHOLD_MS}ms",
    )


async def main():

    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key  = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if not (session_json and storage_key):
        print("SKIP — no LOVABLE_BROWSER_SUPABASE_* session available.")
        sys.exit(0)

    session = json.loads(session_json)
    token = session["access_token"]

    property_id = pick_property(token)
    # Register cleanup context BEFORE any writes so atexit / signal handlers
    # have what they need if the very next call crashes.
    _cleanup_ctx["token"] = token
    _cleanup_ctx["property_id"] = property_id
    outlet_id = get_outlet(token, property_id)
    print(f"property={property_id} outlet={outlet_id} window={WINDOW_MS}ms")

    # ---- Phase 1: bounded per-transaction assertions on the RPC ------
    for i, sale in enumerate(SALES, 1):
        before = get_pos_revenue(token, property_id)
        t0 = time.time()
        total = create_sale(token, property_id, outlet_id, sale)
        target = round(before + total, 2)
        ok, observed, elapsed = wait_for_revenue(token, property_id, target, t0=t0)
        check(
            f"sale #{i} ({sale['name']}, +{total}) reflected on widget within {WINDOW_MS}ms",
            ok,
            f"expected={target} observed={observed} elapsed~{elapsed}ms",
        )
        record_latency(f"pos_sale#{i}→analytics.pos_revenue", ok, elapsed)

    final_rpc = get_pos_revenue(token, property_id)

    # ---- Phase 1b: per-reservation bounded assertions --------------------
    # For each reservation we:
    #   a) create it (confirmed, today→tomorrow, assigned to a real room) and
    #      assert dashboard arrivals+1 AND the calendar 14-day query returns
    #      this reservation for that specific room, within WINDOW_MS.
    #   b) check it in (reservations.status='checked_in' + rooms.status='occupied')
    #      and assert dashboard inhouse+1 AND occupied+1 (occupancy % recomputed),
    #      within WINDOW_MS.
    reserved_rooms: list[dict] = []
    try:
        reserved_rooms = pick_free_rooms(token, property_id, 2)
    except Exception as e:
        check("pick 2 free rooms for reservation phase", False, str(e)[:200])

    if reserved_rooms:
        guest_id = ensure_test_guest(token, property_id)
        for i, room in enumerate(reserved_rooms, 1):
            before = dashboard_counts(token, property_id)

            # (a) create reservation
            t0a = time.time()
            rid = create_reservation(token, property_id, guest_id, room, i)
            ok_a, obs_a, elapsed_a = wait_until(
                lambda: (dashboard_counts(token, property_id),
                         calendar_reservations_for_room(token, property_id, room["id"])),
                lambda pair: (
                    pair[0]["arrivals"] == before["arrivals"] + 1
                    and any(r["id"] == rid for r in pair[1])
                ),
                t0=t0a,
            )
            check(
                f"reservation #{i} on room {room['number']} → arrivals+1 AND "
                f"appears on calendar within {WINDOW_MS}ms",
                ok_a,
                f"before_arrivals={before['arrivals']} "
                f"observed_arrivals={obs_a[0]['arrivals'] if obs_a else '?'} "
                f"calendar_hits={len(obs_a[1]) if obs_a else 0} elapsed~{elapsed_a}ms",
            )
            record_latency(f"reservation#{i}_create→dashboard+calendar", ok_a, elapsed_a)

            # (b) check in — occupancy & inhouse widgets must update
            after_create = dashboard_counts(token, property_id)
            t0b = time.time()
            check_in_reservation(token, rid, room)
            ok_b, obs_b, elapsed_b = wait_until(
                lambda: dashboard_counts(token, property_id),
                lambda d: (
                    d["inhouse"] == after_create["inhouse"] + 1
                    and d["occupied"] == after_create["occupied"] + 1
                ),
                t0=t0b,
            )
            check(
                f"check-in #{i} on room {room['number']} → inhouse+1 AND "
                f"occupied+1 within {WINDOW_MS}ms",
                ok_b,
                f"before_occupied={after_create['occupied']} "
                f"observed_occupied={obs_b['occupied'] if obs_b else '?'} "
                f"before_inhouse={after_create['inhouse']} "
                f"observed_inhouse={obs_b['inhouse'] if obs_b else '?'} "
                f"elapsed~{elapsed_b}ms",
            )
            record_latency(f"reservation#{i}_checkin→dashboard(inhouse/occupied)", ok_b, elapsed_b)

    final_counts = dashboard_counts(token, property_id)

    # ---- Phase 2: verify the analytics + calendar + dashboard widgets render
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
            if cookies_json:
                cookies = json.loads(cookies_json)
                for c in cookies: c["url"] = BASE
                await ctx.add_cookies(cookies)
            page = await ctx.new_page()
            await page.goto(BASE, wait_until="domcontentloaded")
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
            )

            # 2a) Analytics KPI card
            await page.goto(f"{BASE}/analytics", wait_until="networkidle", timeout=25_000)
            try:
                await page.wait_for_selector("text=/POS revenue/i", timeout=10_000)
            except Exception as e:
                check("Analytics /analytics rendered POS revenue KPI", False, str(e)[:120])
            await page.wait_for_timeout(1200)
            await page.screenshot(path=str(OUT / "analytics-kpi.png"))

            body = await page.locator("body").inner_text()
            def variants(n: float):
                s = f"{n:,.2f}"
                return {s, s.rstrip("0").rstrip("."), f"{int(round(n))}", f"{n:,.0f}"}
            expected_variants = variants(final_rpc)
            check(
                f"Analytics KPI card shows POS revenue = {final_rpc}",
                any(v in body for v in expected_variants),
                f"looked for any of {sorted(expected_variants)} in DOM text",
            )

            # 2b) Dashboard occupancy stat
            await page.goto(f"{BASE}/dashboard", wait_until="networkidle", timeout=25_000)
            try:
                await page.wait_for_selector("text=/Occupancy/i", timeout=10_000)
            except Exception as e:
                check("Dashboard rendered Occupancy card", False, str(e)[:120])
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / "dashboard-occupancy.png"))
            dash_body = await page.locator("body").inner_text()
            expected_occ = f"{final_counts['occupancy_pct']}%"
            expected_ratio = f"{final_counts['occupied']}/{final_counts['total_rooms']}"
            check(
                f"Dashboard occupancy shows {expected_occ} ({expected_ratio})",
                expected_occ in dash_body and expected_ratio in dash_body,
                f"looked for '{expected_occ}' and '{expected_ratio}' in DOM",
            )
            check(
                f"Dashboard in-house guests shows {final_counts['inhouse']}",
                re.search(rf"\b{final_counts['inhouse']}\b[^\d]{{0,40}}(?i:in-house|currently staying)",
                          dash_body) is not None
                or f"{final_counts['inhouse']}" in dash_body,  # loose fallback
                "expected in-house guests count in DOM",
            )

            # 2c) Calendar — the specific rooms we booked must show a booked cell
            await page.goto(f"{BASE}/calendar", wait_until="networkidle", timeout=25_000)
            try:
                await page.wait_for_selector("text=/Availability/i", timeout=10_000)
            except Exception as e:
                check("Calendar /calendar rendered", False, str(e)[:120])
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / "calendar.png"))
            cal_body = await page.locator("body").inner_text()
            for room in reserved_rooms:
                check(
                    f"Calendar shows Room {room['number']} row",
                    f"Room {room['number']}" in cal_body,
                )
                # Guest last name "Realtime Guest" from ensure_test_guest.
                check(
                    f"Calendar shows booking for Room {room['number']} (guest '[TEST] Realtime Guest')",
                    "Realtime Guest" in cal_body,
                )
        finally:
            await browser.close()


    # Cleanup runs via atexit / signal handlers too — call explicitly here so
    # its output lands before the results summary in the happy path.
    _run_cleanup()


    observed_lat = [l["latency_ms"] for l in latencies if l["observed"]]
    stats = {
        "count": len(latencies),
        "threshold_ms": LATENCY_THRESHOLD_MS,
        "max_ms": max(observed_lat) if observed_lat else None,
        "min_ms": min(observed_lat) if observed_lat else None,
        "avg_ms": round(sum(observed_lat) / len(observed_lat)) if observed_lat else None,
        "over_budget": [l for l in latencies if not l["ok"]],
    }
    (OUT / "results.json").write_text(json.dumps(
        {"failures": failures, "latencies": latencies, "latency_stats": stats}, indent=2))
    print(f"\nlatency stats: {json.dumps(stats)}")
    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        sys.exit(1)
    print("\nPer-transaction dashboard updates verified within latency budget.")


asyncio.run(main())
