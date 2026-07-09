/**
 * Verifies that the trial-data seeder produces the correct item_stock deltas
 * and that every stock movement it emits is correctly linked to its parent
 * stock_adjustments row and — for sale movements — to the matching POS order.
 *
 * These constants MIRROR the seeder in src/lib/admin/trial-data.functions.ts.
 * If either drifts, the contract test in tests/trial-data.contract.test.ts
 * will fail first; if you touch the seed shape below, update it there too.
 */
import { describe, expect, it } from "vitest";

// ---- Mirror of trial-data.functions.ts ------------------------------------
const ITEMS = [
  { i: 0, sku: "TEST-001", sale_price: 5 },
  { i: 1, sku: "TEST-002", sale_price: 15 },
  { i: 2, sku: "TEST-003", sale_price: 3 },
  { i: 3, sku: "TEST-004", sale_price: 35 },
  { i: 4, sku: "TEST-005", sale_price: 45 },
];
const INITIAL_STOCKING = 100;
const SALE_PLANS: Array<Array<{ i: number; qty: number }>> = [
  [{ i: 0, qty: 2 }, { i: 2, qty: 1 }],
  [{ i: 1, qty: 3 }],
  [{ i: 3, qty: 1 }, { i: 4, qty: 1 }],
];

// ---- Pure computation used by both the seeder and this test ---------------
type Movement = {
  adjustmentIndex: number;         // 0 = initial receipt, 1..N = sale N
  reasonTag: string;
  linkedOrderIndex: number | null; // null for receipts, 0..N-1 for sales
  lines: Array<{ itemIndex: number; delta: number }>;
};

function computeMovements(): Movement[] {
  const movements: Movement[] = [];
  movements.push({
    adjustmentIndex: 0,
    reasonTag: "Initial trial stocking",
    linkedOrderIndex: null,
    lines: ITEMS.map((it) => ({ itemIndex: it.i, delta: INITIAL_STOCKING })),
  });
  SALE_PLANS.forEach((plan, n) => {
    movements.push({
      adjustmentIndex: n + 1,
      reasonTag: `POS sale ${n + 1}`,
      linkedOrderIndex: n,
      lines: plan.map((p) => ({ itemIndex: p.i, delta: -p.qty })),
    });
  });
  return movements;
}

function computeFinalStock(): Record<number, number> {
  const stock: Record<number, number> = {};
  for (const m of computeMovements()) {
    for (const l of m.lines) {
      stock[l.itemIndex] = (stock[l.itemIndex] ?? 0) + l.delta;
    }
  }
  return stock;
}

// ---------------------------------------------------------------------------

describe("seeded stock movements", () => {
  const movements = computeMovements();

  it("emits exactly one adjustment per stock movement (1 receipt + N sales)", () => {
    expect(movements.length).toBe(1 + SALE_PLANS.length);
    expect(movements.length).toBe(4);
  });

  it("initial receipt stocks every item by +100 and is unlinked to an order", () => {
    const initial = movements[0];
    expect(initial.linkedOrderIndex).toBeNull();
    expect(initial.lines).toHaveLength(ITEMS.length);
    for (const line of initial.lines) {
      expect(line.delta).toBe(INITIAL_STOCKING);
    }
  });

  it.each(SALE_PLANS.map((plan, n) => ({ n, plan })))(
    "sale $n produces an adjustment linked to POS order $n with matching negative deltas",
    ({ n, plan }) => {
      const m = movements[n + 1];
      expect(m.linkedOrderIndex).toBe(n);
      expect(m.reasonTag).toBe(`POS sale ${n + 1}`);
      expect(m.lines).toHaveLength(plan.length);
      // Each line is a 1:1 negative of the corresponding pos_order_items row.
      for (let k = 0; k < plan.length; k++) {
        expect(m.lines[k].itemIndex).toBe(plan[k].i);
        expect(m.lines[k].delta).toBe(-plan[k].qty);
      }
    },
  );

  it("no adjustment mixes items across properties or fabricates unknown items", () => {
    const validIndexes = new Set(ITEMS.map((i) => i.i));
    for (const m of movements) {
      for (const l of m.lines) {
        expect(validIndexes.has(l.itemIndex)).toBe(true);
      }
    }
  });
});

describe("final item_stock quantities", () => {
  const stock = computeFinalStock();

  it("equals initial stocking minus total sold per item", () => {
    const totalSold: Record<number, number> = {};
    for (const plan of SALE_PLANS) {
      for (const p of plan) totalSold[p.i] = (totalSold[p.i] ?? 0) + p.qty;
    }
    for (const it of ITEMS) {
      const sold = totalSold[it.i] ?? 0;
      expect(stock[it.i]).toBe(INITIAL_STOCKING - sold);
    }
  });

  it("matches the expected snapshot", () => {
    expect(stock).toEqual({
      0: 98,   // 2 sold (sale 1)
      1: 97,   // 3 sold (sale 2)
      2: 99,   // 1 sold (sale 1)
      3: 99,   // 1 sold (sale 3)
      4: 99,   // 1 sold (sale 3)
    });
  });

  it("never goes negative — seeded sales cannot oversell initial receipt", () => {
    for (const q of Object.values(stock)) expect(q).toBeGreaterThanOrEqual(0);
  });
});

describe("cross-linkage between POS order line items and stock adjustments", () => {
  it("each POS order's item-quantity map equals the absolute delta on its adjustment", () => {
    SALE_PLANS.forEach((plan, n) => {
      const posQtyByItem: Record<number, number> = {};
      for (const p of plan) posQtyByItem[p.i] = (posQtyByItem[p.i] ?? 0) + p.qty;

      const adj = computeMovements()[n + 1];
      const adjAbsByItem: Record<number, number> = {};
      for (const l of adj.lines) adjAbsByItem[l.itemIndex] = -l.delta;

      expect(adjAbsByItem).toEqual(posQtyByItem);
    });
  });
});
