# Playwright smoke: navigates the signed-in user (super_admin) through every
# ROUTE_ROLE_MAP prefix and confirms the router does not bounce to /auth.
#
# Extending this to N roles requires N seeded users (needs the service-role
# key, which is unavailable on Lovable Cloud). Per-role logic is covered by
# the pure-function matrix in tests/rbac.matrix.test.ts.
#
# Run inside the sandbox:  python3 tests/rbac.playwright.py
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROUTES = [
    "/admin/uploads", "/admin/online-users", "/admin/audit",
    "/admin/system-updates", "/admin/backup", "/admin",
    "/settings/roles-matrix", "/settings/roles", "/settings/guest-id-types",
    "/properties", "/accounting/sync", "/accounting",
    "/analytics", "/reports", "/channels", "/inventory",
    "/pos", "/rooms", "/rates", "/housekeeping",
    "/reservations", "/calendar", "/guests",
]

OUT = Path("/tmp/browser/rbac"); OUT.mkdir(parents=True, exist_ok=True)

async def main():
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        if cookies_json:
            cookies = json.loads(cookies_json)
            for c in cookies: c["url"] = "http://localhost:8080"
            await context.add_cookies(cookies)

        await page.goto("http://localhost:8080", wait_until="domcontentloaded")
        if storage_key and session_json:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
            )

        results = []
        for route in ROUTES:
            try:
                await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=15000)
            except Exception as e:
                results.append({"route": route, "status": "timeout", "final": page.url, "error": str(e)[:120]})
                continue
            final = page.url
            bounced = "/auth" in final and "/auth" not in route
            slug = route.strip("/").replace("/", "_") or "root"
            await page.screenshot(path=str(OUT / f"{slug}.png"))
            results.append({"route": route, "status": "bounced" if bounced else "ok", "final": final})

        (OUT / "results.json").write_text(json.dumps(results, indent=2))
        print(json.dumps(results, indent=2))
        await browser.close()

asyncio.run(main())
