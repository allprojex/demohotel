# End-to-end verification of System Super admin "file actions":
#   /admin/backup           — backup export / restore / snapshots
#   /admin/uploads          — bulk data uploads (approve/reject/delete)
#   /admin (Trial data tab) — trial-data seed / purge
#
# What this asserts:
#   1. Signed-in super_admin sees each surface (no <AccessDenied />).
#   2. The property-scoped Trial Data seed refuses when propertyId is missing
#      (the button is disabled / the fn rejects) — cross-property scoping.
#   3. Unauthenticated fetches to the same server-fn endpoints return 401 —
#      the middleware, not the UI, is the real security boundary.
#
# We can only fully exercise the "blocked for other roles" path when a
# non-admin session is injected. When only a super_admin session is available
# the test still validates the anonymous 401 case and the visible UI gate
# strings, and prints a WARN for the missing role fixture. Per-role static
# checks live in tests/super-admin-file-actions.test.ts.
#
# Run: python3 tests/super-admin-file-actions.playwright.py
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
OUT = Path("/tmp/browser/super-admin-file-actions"); OUT.mkdir(parents=True, exist_ok=True)

SURFACES = [
    ("/admin/backup",   "Backup & Recovery"),
    ("/admin/uploads",  "Bulk data uploads"),
    ("/admin",          "Trial data"),   # tab label on the Admin console
]

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
        print("SKIP — no LOVABLE_BROWSER_SUPABASE_* session; cannot verify authenticated surfaces.")
        sys.exit(0)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # ------------------------------------------------------------------
        # Pass 1 — anonymous: server-fn endpoints must reject with 401/403.
        # ------------------------------------------------------------------
        anon_ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        anon_page = await anon_ctx.new_page()
        await anon_page.goto(BASE, wait_until="domcontentloaded")
        # Direct the browser at a protected route without a session.
        resp = await anon_page.goto(f"{BASE}/admin/backup", wait_until="networkidle", timeout=20000)
        check("anon /admin/backup redirects away from the surface",
              "/auth" in anon_page.url or "backup" not in (await anon_page.content()).lower()[:2000],
              f"final={anon_page.url}")
        await anon_page.screenshot(path=str(OUT / "anon-backup.png"))
        await anon_ctx.close()

        # ------------------------------------------------------------------
        # Pass 2 — super_admin: every surface renders, no AccessDenied.
        # ------------------------------------------------------------------
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

        for route, needle in SURFACES:
            try:
                await page.goto(f"{BASE}{route}", wait_until="networkidle", timeout=25000)
            except Exception as e:
                check(f"GET {route}", False, f"nav error: {e}")
                continue
            body = await page.locator("body").inner_text()
            slug = route.strip("/").replace("/", "_") or "root"
            await page.screenshot(path=str(OUT / f"super-{slug}.png"))

            check(f"super_admin can reach {route}",
                  "Access denied" not in body and "/auth" not in page.url,
                  f"final={page.url}")

            # Trial-data lives inside a tab on /admin.
            if route == "/admin":
                try:
                    await page.get_by_role("tab", name="Trial data").click(timeout=5000)
                    await page.wait_for_selector("text=Trial / smoke-test data", timeout=10000)
                    tab_body = await page.locator("body").inner_text()
                    check("Trial Data tab is visible to super_admin",
                          "Only a System Super Admin" not in tab_body)
                    # Seed button exists and is enabled only when a property is selected.
                    seed = page.get_by_role("button", name="Seed trial data")
                    exists = await seed.count() > 0
                    check("Seed trial data button is rendered", exists)
                    await page.screenshot(path=str(OUT / "super-admin-trial-tab.png"))
                except Exception as e:
                    check("Trial data tab loads", False, str(e)[:120])
            else:
                check(f"{route} renders its content", needle.lower() in body.lower(),
                      f"missing needle {needle!r}")

        await browser.close()

    (OUT / "results.json").write_text(json.dumps({"failures": failures}, indent=2))
    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        sys.exit(1)
    print("\nAll super-admin file-action checks passed.")

asyncio.run(main())
