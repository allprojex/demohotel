/**
 * Locks the seeded-trial-data contract used by scripts/smoke-trial.mjs.
 *
 * These constants are the single source of truth for what the seeder promises
 * and what the smoke test asserts. If the seeder in
 * src/lib/admin/trial-data.functions.ts changes, update this file — the
 * end-to-end smoke script consumes the same numbers.
 */
import { describe, expect, it } from "vitest";

export const TRIAL_CONTRACT = {
  items: 5,
  suppliers: 2,
  posOrders: 3,
  // 1 initial stocking receipt + 1 per POS sale (deduction).
  stockAdjustments: 4,
  notifications: 1,
  // 2 * 5 + 1 * 3 + 3 * 15 + (12 miss — sandwich sale_price 35) + 45
  // Kept for reference; dashboard smoke only asserts the widgets render.
  expectedRevenue: 2 * 5 + 1 * 3 + 3 * 15 + 35 + 45,
  skuPrefix: "TEST-",
  namePrefix: "[TEST]",
};

describe("trial-data contract", () => {
  it("keeps counts in sync with the seeder", () => {
    expect(TRIAL_CONTRACT.items).toBe(5);
    expect(TRIAL_CONTRACT.suppliers).toBe(2);
    expect(TRIAL_CONTRACT.posOrders).toBe(3);
    expect(TRIAL_CONTRACT.stockAdjustments).toBe(
      1 + TRIAL_CONTRACT.posOrders,
    );
  });

  it("uses reversible tags on every row", () => {
    // Purge relies on ilike '[TEST]%' / ilike 'TEST-%' filters.
    expect(TRIAL_CONTRACT.namePrefix.startsWith("[TEST]")).toBe(true);
    expect(TRIAL_CONTRACT.skuPrefix).toBe("TEST-");
  });
});
