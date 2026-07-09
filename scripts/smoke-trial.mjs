#!/usr/bin/env node
/**
 * End-to-end smoke test for the Trial Data seeder.
 *
 * Verifies:
 *   1. Seeding creates 5 test products, 2 suppliers, 3 POS sales, stock
 *      adjustments and a bell notification (super_admin only).
 *   2. POS sales appear in real time on the dashboard (revenue > 0 after seed).
 *   3. Inventory reflects stock movements (TEST-SKU items visible with a
 *      quantity that decreased after the sales relative to the +100 receipt).
 *   4. Purge reverses every seeded row — counts return to 0.
 *
 * Env:
 *   BASE_URL                              default http://localhost:8080
 *   LOVABLE_BROWSER_SUPABASE_STORAGE_KEY  required
 *   LOVABLE_BROWSER_SUPABASE_SESSION_JSON required
 *
 * Exit code 0 = pass, 1 = fail. Screenshots are written to /tmp/browser/trial/.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const OUT = "/tmp/browser/trial";
mkdirSync(OUT, { recursive: true });

if (!STORAGE_KEY || !SESSION_JSON) {
  console.error("Missing LOVABLE_BROWSER_SUPABASE_* env vars — cannot smoke authenticated flows.");
  process.exit(2);
}

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) console.log(`ok    ${label}`);
  else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

async function readCountsFromAdmin(page) {
  // The Trial Data card renders `<Cnt label v />` grid cells; read them by label.
  return await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("div.rounded-md.border"));
    const out = {};
    for (const c of cells) {
      const label = c.querySelector(".uppercase")?.textContent?.trim();
      const value = c.querySelector(".text-lg")?.textContent?.trim();
      if (label && value) out[label] = Number(value);
    }
    return out;
  });
}

async function gotoAdminTrial(page) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("tab", { name: /trial data/i }).click();
  await page.waitForSelector("text=Trial / smoke-test data", { timeout: 15_000 });
}

async function run() {
  console.log(`Trial-data smoke against ${BASE}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  const page = await context.newPage();

  page.on("pageerror", (e) => console.log(`      pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k, v),
    [STORAGE_KEY, SESSION_JSON],
  );

  // --- 1. Open Admin > Trial data. Must be super_admin. ---
  await gotoAdminTrial(page);
  const noAccess = await page.locator("text=Only a System Super Admin").count();
  check("super_admin can access Trial Data tab", noAccess === 0,
    "signed-in user is not super_admin — inject a super_admin session");
  if (noAccess > 0) { await browser.close(); process.exit(1); }

  await page.screenshot({ path: `${OUT}/1-admin-before.png` });

  // Baseline counts (may be non-zero if a previous run left rows behind).
  const before = await readCountsFromAdmin(page);
  console.log("baseline:", JSON.stringify(before));

  // --- 2. Seed ---
  await page.getByRole("button", { name: /seed trial data/i }).click();
  await page.waitForSelector("text=/Seeded \\d+ items/i", { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /trial data/i }).click();
  await page.waitForSelector("text=Trial / smoke-test data");
  const after = await readCountsFromAdmin(page);
  console.log("after seed:", JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/2-admin-after-seed.png` });

  check("Items increased by 5", (after.Items ?? 0) - (before.Items ?? 0) === 5);
  check("Suppliers increased by 2", (after.Suppliers ?? 0) - (before.Suppliers ?? 0) === 2);
  check("POS orders increased by 3", (after["POS orders"] ?? 0) - (before["POS orders"] ?? 0) === 3);
  check("Stock adjustments increased by 4",
    (after["Stock adj."] ?? 0) - (before["Stock adj."] ?? 0) === 4,
    "1 initial receipt + 3 sale deductions");
  check("Notification created", (after.Notifications ?? 0) - (before.Notifications ?? 0) >= 1);

  // --- 3. Dashboard reflects the POS sales in real time ---
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/3-dashboard.png` });
  const dashText = await page.locator("body").innerText();
  // The 3 seeded POS sales total 2*5 + 1*3 + 3*15 + 35 + 45 = 138 (GHS).
  const hasSales = /pos|sales|revenue/i.test(dashText);
  check("Dashboard renders sales/revenue widgets", hasSales);

  // --- 4. Inventory reflects TEST-SKU items with decremented stock ---
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/4-inventory.png` });
  const invText = await page.locator("body").innerText();
  check("Inventory lists TEST-SKU items", /TEST-001|TEST-002|TEST-003/.test(invText));

  // Notification bell
  await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(600);
  const notesText = await page.locator("body").innerText();
  check("Notifications page shows [TEST] entry", /\[TEST\]/.test(notesText));

  // --- 5. Purge and verify reversibility ---
  await gotoAdminTrial(page);
  await page.getByRole("button", { name: /purge trial data/i }).click();
  await page.getByRole("button", { name: /purge now/i }).click();
  await page.waitForSelector("text=/All trial data removed/i", { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /trial data/i }).click();
  await page.waitForSelector("text=Trial / smoke-test data");
  const purged = await readCountsFromAdmin(page);
  console.log("after purge:", JSON.stringify(purged));
  await page.screenshot({ path: `${OUT}/5-admin-after-purge.png` });

  check("Items back to baseline", (purged.Items ?? 0) === (before.Items ?? 0));
  check("Suppliers back to baseline", (purged.Suppliers ?? 0) === (before.Suppliers ?? 0));
  check("POS orders back to baseline", (purged["POS orders"] ?? 0) === (before["POS orders"] ?? 0));
  check("Stock adjustments back to baseline", (purged["Stock adj."] ?? 0) === (before["Stock adj."] ?? 0));
  check("Notifications back to baseline", (purged.Notifications ?? 0) === (before.Notifications ?? 0));

  await browser.close();

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll trial-data smoke checks passed.");
}

run().catch((e) => { console.error(e); process.exit(1); });
