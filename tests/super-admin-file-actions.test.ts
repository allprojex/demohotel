/**
 * Guard tests for System Super admin "file actions" — backup / restore /
 * snapshot / schedule / trial data seed / trial data purge / uploads.
 *
 * These are static checks that lock the RBAC gates in place. They read the
 * source of each server-function module and assert that every exported
 * `createServerFn` chain:
 *
 *   1. is wrapped in `requireSupabaseAuth` (no anonymous callers), and
 *   2. calls a super-admin (or property-scoped admin) assertion inside its
 *      handler, and
 *   3. — for the property-scoped actions — validates `propertyId` in its
 *      inputValidator so cross-property scoping cannot be bypassed by a
 *      missing/undefined id.
 *
 * Runtime enforcement is separately covered by the RLS regression suite
 * (`tests/security.regression.test.ts`) and the Playwright end-to-end script
 * (`tests/super-admin-file-actions.playwright.py`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

// ---- Backup / restore / snapshots / schedules (super_admin only) ----------
describe("backup file actions", () => {
  const src = read("src/lib/backup.functions.ts");
  const fns = [
    "exportBackup", "restoreBackup",
    "listSchedules", "upsertSchedule", "deleteSchedule", "runScheduleNow",
    "listSnapshots", "getSnapshotDownloadUrl", "restoreFromSnapshot",
  ];

  it.each(fns)("%s is auth-gated", (fn) => {
    // The export appears once and is followed (within ~40 lines) by both
    // requireSupabaseAuth and assertSuperAdmin.
    const idx = src.indexOf(`export const ${fn}`);
    expect(idx, `${fn} export`).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 2000);
    expect(block).toMatch(/requireSupabaseAuth/);
    expect(block).toMatch(/assertSuperAdmin\(context\)/);
  });
});

// ---- Trial data (super_admin + property-scoped admin) ---------------------
describe("trial data file actions", () => {
  const src = read("src/lib/admin/trial-data.functions.ts");
  const fns = ["trialDataCounts", "seedTrialData", "purgeTrialData"];

  it.each(fns)("%s requires auth + validates propertyId", (fn) => {
    const idx = src.indexOf(`export const ${fn}`);
    expect(idx, `${fn} export`).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 2000);
    expect(block).toMatch(/requireSupabaseAuth/);
    expect(block).toMatch(/propertyId required/);
  });

  it("seed and purge assert super_admin before touching data", () => {
    for (const fn of ["seedTrialData", "purgeTrialData"]) {
      const idx = src.indexOf(`export const ${fn}`);
      const block = src.slice(idx, idx + 3000);
      expect(block, fn).toMatch(/assertSuperAdmin/);
    }
  });

  it("seed additionally asserts property-scoped admin", () => {
    const idx = src.indexOf("export const seedTrialData");
    const block = src.slice(idx, idx + 3000);
    expect(block).toMatch(/assertPropertyAdmin\(s, context\.userId, data\.propertyId\)/);
  });

  it("has_role/has_any_role RPCs are the authoritative source of truth", () => {
    // The gate MUST call the DB-side security-definer function — not a
    // client-computed list — so a compromised client cannot spoof roles.
    expect(src).toMatch(/rpc\("has_role"/);
    expect(src).toMatch(/rpc\("has_any_role"/);
  });
});

// ---- Uploads (property-scoped admin: super_admin | owner | GM) ------------
describe("upload file actions", () => {
  const src = read("src/lib/uploads.functions.ts");
  const fns = ["createUpload", "approveUpload", "rejectUpload", "deleteUpload"];

  it.each(fns)("%s requires auth + property admin", (fn) => {
    const idx = src.indexOf(`export const ${fn}`);
    expect(idx, `${fn} export`).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 2500);
    expect(block).toMatch(/requireSupabaseAuth/);
    expect(block).toMatch(/assertAdmin\(context, data\.propertyId\)/);
  });

  it("assertAdmin resolves roles via has_any_role RPC scoped to the property", () => {
    expect(src).toMatch(/rpc\("has_any_role"/);
    expect(src).toMatch(/_property_id: propertyId/);
    // The whitelist is exactly super_admin + hotel_owner + general_manager.
    expect(src).toMatch(/\["super_admin", "hotel_owner", "general_manager"\]/);
  });
});
