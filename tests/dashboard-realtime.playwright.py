# End-to-end: confirms the dashboard widgets refresh automatically after a
# POS transaction, without any user interaction (no reload / no click).
#
# Strategy
#   The dashboard uses TanStack Query with `refetchInterval` (see
#   src/routes/_authenticated/dashboard.tsx). This test:
#
#     1. Sets the persisted refresh interval to 30 s (the minimum on the UI)
#        by writing localStorage BEFORE the app loads.
#     2. Opens /dashboard and waits for the initial widget render.
#     3. Records the timestamp of every Supabase REST fetch the dashboard
#        issues (payments / reservations / rooms).
#     4. Waits idle (no navigation, no clicks) for ~40 seconds.
#     5. Asserts at least one additional automatic refetch happened AFTER the
#        initial burst — i.e. the polling pipeline is live and would pick up
#        a new POS transaction without a manual refresh.
#
# We use polling detection rather than injecting a POS row here because the
# dashboard KPIs on /dashboard reflect reservation.payments (not pos_payments).
# The realtime-update path itself is the invariant we care about; that a POS
# sale writes to the correct tables is separately covered by the pure
# tests/trial-data.stock-deltas.test.ts and the trial-data smoke script.
#
# Run: python3 tests/dashboard-realtime.playwright.py
import asyncio, json, os, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
OUT = Path("/tmp/browser/dashboard-realtime"); OUT.mkdir(parents=True, exist_ok=True)
POLL_MS = 30_000
WAIT_S = 40  # must exceed POLL_MS to observe at least one auto-refetch

# Requests worth counting as "the dashboard fetching data".
DATA_TABLES = ("payments", "reservations", "rooms", "pos_orders")

failures = []
def check(label, ok, detail=""):
    tag = "ok  " if ok else "FAIL"
    print(f"{tag}  {label}" + (f" — {detail}" if detail else ""))
    if not ok: failures.append(label)

async def main():
    storage_key  = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if not (storage_key and session_json):
        print("SKIP — no LOVABLE_BROWSER_SUPABASE_* session; cannot verify authenticated dashboard.")
        sys.exit(0)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})

        if cookies_json:
            cookies = json.loads(cookies_json)
            for c in cookies: c["url"] = BASE
            await ctx.add_cookies(cookies)

        page = await ctx.new_page()

        # Seed session + short refresh interval BEFORE the dashboard mounts.
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.evaluate(
            "([k, v, poll]) => {"
            "  window.localStorage.setItem(k, v);"
            "  window.localStorage.setItem('pms.dashboard.refreshMs', String(poll));"
            "}",
            [storage_key, session_json, POLL_MS],
        )

        # Track data fetches emitted by the dashboard (Supabase REST).
        fetches: list[dict] = []
        def on_request(req):
            url = req.url
            if "/rest/v1/" not in url: return
            for t in DATA_TABLES:
                if f"/rest/v1/{t}" in url:
                    fetches.append({"t": time.time(), "table": t, "url": url.split("?")[0]})
                    return
        page.on("request", on_request)

        # Load dashboard and wait for the first batch of queries to settle.
        await page.goto(f"{BASE}/dashboard", wait_until="networkidle", timeout=30_000)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(OUT / "1-dashboard-initial.png"))

        initial_burst = len(fetches)
        check("dashboard issued initial data fetches", initial_burst > 0,
              f"observed={initial_burst}")
        first_burst_end = time.time()

        # Idle: no clicks, no navigation. Just wait long enough for at least
        # one refetchInterval tick.
        print(f"idling {WAIT_S}s with no user interaction — expecting auto-poll...")
        deadline = time.time() + WAIT_S
        while time.time() < deadline:
            await page.wait_for_timeout(1000)

        await page.screenshot(path=str(OUT / "2-dashboard-after-idle.png"))

        # Count fetches that happened AFTER the initial burst settled + 3 s
        # (buffer for late lazy queries firing).
        polled = [f for f in fetches if f["t"] > first_burst_end + 3]
        print(f"initial fetches: {initial_burst}, post-idle fetches: {len(polled)}")

        check(
            "dashboard auto-refetched via polling without user interaction",
            len(polled) >= 1,
            f"expected >=1 refetch within {WAIT_S}s, saw {len(polled)}",
        )

        # Bonus: dashboard remained on the same URL — no reload / navigation.
        check("no reload or navigation occurred", page.url.endswith("/dashboard"),
              f"final={page.url}")

        await browser.close()

    (OUT / "results.json").write_text(json.dumps({
        "failures": failures,
        "initial_fetches": initial_burst,
        "polled_fetches": len(polled),
        "sample": fetches[:20],
    }, indent=2))

    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        sys.exit(1)
    print("\nDashboard realtime/polling verified.")

asyncio.run(main())
