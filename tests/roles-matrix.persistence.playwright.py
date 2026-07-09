"""E2E: toggle several roles-matrix checkboxes across two roles and verify
persistence across reload without Supabase ON CONFLICT errors.

Run: python3 tests/roles-matrix.persistence.playwright.py
Requires managed Supabase session env (LOVABLE_BROWSER_* — see harness docs).
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ROUTE = f"{BASE}/settings/roles-matrix"
SHOTS = Path("/tmp/browser/roles-matrix-e2e")
SHOTS.mkdir(parents=True, exist_ok=True)

# (role_label_in_sidebar, module_row_text, action_index_in_ACTIONS)
# ACTIONS = ["create","read","update","delete","approve","export","import","print","manage"]
TOGGLES = [
    ("front desk", "reservations", 0),  # create
    ("front desk", "guests", 1),        # read
    ("front desk", "housekeeping", 2),  # update
    ("manager",    "pos", 4),           # approve
    ("manager",    "reports", 5),       # export
    ("manager",    "inventory", 8),     # manage
]


async def restore_session(context, page):
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await context.add_cookies(cookies)
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def select_role(page, role_label: str):
    # Sidebar buttons render the role key with underscores replaced by spaces.
    btn = page.get_by_role("button", name=role_label, exact=True)
    await btn.first.click()
    await page.wait_for_timeout(400)  # give react-query time to refetch


async def checkbox_for(page, module: str, action_index: int):
    row = page.locator("table tbody tr", has=page.locator("td", has_text=module)).first
    return row.locator('button[role="checkbox"]').nth(action_index)


async def state_of(cb) -> str:
    return await cb.get_attribute("data-state") or "unknown"


async def toggle_to(page, cb, desired: str):
    cur = await state_of(cb)
    if cur != desired:
        await cb.click()
        await page.wait_for_timeout(350)
    return await state_of(cb)


async def main() -> int:
    conflict_errors: list[tuple[int, str, str]] = []
    role_perm_4xx: list[tuple[int, str, str]] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        async def on_resp(resp):
            if "role_permissions" not in resp.url:
                return
            if resp.status < 400:
                return
            try:
                body = await resp.text()
            except Exception:
                body = ""
            role_perm_4xx.append((resp.status, resp.url, body[:400]))
            if "ON CONFLICT" in body or '"42P10"' in body:
                conflict_errors.append((resp.status, resp.url, body[:400]))

        page.on("response", lambda r: asyncio.create_task(on_resp(r)))

        await restore_session(context, page)
        await page.goto(ROUTE, wait_until="networkidle")
        await page.screenshot(path=str(SHOTS / "01_loaded.png"))

        # Phase 1: read initial state, then flip each target and record desired.
        desired_state: dict[tuple[str, str, int], str] = {}
        for role, module, idx in TOGGLES:
            await select_role(page, role)
            cb = await checkbox_for(page, module, idx)
            before = await state_of(cb)
            target = "unchecked" if before == "checked" else "checked"
            after = await toggle_to(page, cb, target)
            desired_state[(role, module, idx)] = after
            print(f"toggled  role={role!r} module={module!r} action_idx={idx} {before} -> {after}")

        await page.screenshot(path=str(SHOTS / "02_after_toggles.png"))

        # Phase 2: hard reload and verify each is still the desired state.
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(400)

        mismatches: list[str] = []
        for role, module, idx in TOGGLES:
            await select_role(page, role)
            cb = await checkbox_for(page, module, idx)
            got = await state_of(cb)
            want = desired_state[(role, module, idx)]
            status = "OK" if got == want else "MISMATCH"
            print(f"reload   role={role!r} module={module!r} action_idx={idx} want={want} got={got} {status}")
            if got != want:
                mismatches.append(f"{role}/{module}#{idx}: want={want} got={got}")

        await page.screenshot(path=str(SHOTS / "03_after_reload.png"))

        # Phase 3: revert to leave DB state as we found it.
        for role, module, idx in TOGGLES:
            await select_role(page, role)
            cb = await checkbox_for(page, module, idx)
            cur = await state_of(cb)
            revert = "unchecked" if cur == "checked" else "checked"
            await toggle_to(page, cb, revert)

        await browser.close()

    print("\n=== RESULT ===")
    print(f"role_permissions 4xx responses: {len(role_perm_4xx)}")
    for s, u, b in role_perm_4xx:
        print(f"  {s} {u}\n    {b}")
    print(f"ON CONFLICT errors: {len(conflict_errors)}")
    print(f"reload mismatches: {len(mismatches)}")
    for m in mismatches:
        print(f"  {m}")

    ok = not conflict_errors and not mismatches and not role_perm_4xx
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
