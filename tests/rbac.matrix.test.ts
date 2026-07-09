/**
 * RBAC matrix test — asserts per-role route access rules.
 * Run:  bunx vitest run tests/rbac.matrix.test.ts
 */
import { describe, it, expect } from "vitest";
import { isAllowed } from "@/lib/admin/route-permissions";
import type { AppRole } from "@/hooks/use-user-roles";

const PROP = "prop-1";
const rows = (role: AppRole, property: string | null = PROP) => [{ role, property_id: property }];

type Case = { role: AppRole; allow: string[]; deny: string[] };

const CASES: Case[] = [
  { role: "super_admin",
    allow: ["/admin/backup", "/admin/uploads", "/pos", "/accounting", "/reports", "/rooms", "/settings/roles-matrix"],
    deny: [] },
  { role: "super_admin",
    allow: ["/admin/backup", "/admin/rbac-preview", "/admin/uploads", "/pos", "/accounting", "/reports", "/rooms", "/settings/roles-matrix"],
    deny: [] },
  { role: "hotel_owner",
    allow: ["/admin/uploads", "/admin/audit", "/accounting", "/reports", "/pos", "/rooms", "/properties"],
    deny: ["/admin/backup", "/admin/rbac-preview"] },
  { role: "general_manager",
    allow: ["/admin/uploads", "/accounting/sync", "/reports", "/pos"],
    deny: ["/admin/backup"] },
  { role: "manager",
    allow: [],
    deny: ["/admin", "/admin/backup", "/settings/roles-matrix", "/pos", "/reports", "/accounting", "/properties"] },
  { role: "front_desk",
    allow: ["/pos", "/rooms", "/reservations", "/calendar", "/guests"],
    deny: ["/admin", "/accounting", "/reports", "/inventory", "/housekeeping", "/channels", "/rates", "/settings/roles-matrix"] },
  { role: "reservations",
    allow: ["/channels", "/rooms", "/rates", "/reservations", "/calendar", "/guests"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/inventory", "/housekeeping"] },
  { role: "cashier",
    allow: ["/pos"],
    deny: ["/admin", "/accounting", "/reports", "/inventory", "/rooms", "/reservations", "/housekeeping"] },
  { role: "restaurant_manager",
    allow: ["/pos"],
    deny: ["/admin", "/accounting", "/reports", "/reservations", "/rooms"] },
  { role: "waiter",
    allow: ["/pos"],
    deny: ["/admin", "/accounting", "/inventory", "/reservations", "/rooms", "/reports"] },
  { role: "kitchen",
    allow: ["/pos"],
    deny: ["/admin", "/accounting", "/inventory", "/reservations", "/rooms", "/reports"] },
  { role: "accountant",
    allow: ["/accounting", "/accounting/sync", "/inventory", "/reports", "/analytics"],
    deny: ["/admin", "/admin/backup", "/pos", "/rooms", "/reservations", "/housekeeping", "/settings/roles-matrix"] },
  { role: "auditor",
    allow: ["/accounting", "/reports", "/analytics", "/admin/audit"],
    deny: ["/admin", "/admin/uploads", "/admin/backup", "/admin/system-updates", "/pos", "/rooms", "/inventory", "/settings/roles-matrix"] },
  { role: "housekeeping_supervisor",
    allow: ["/housekeeping", "/rooms", "/calendar"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/reservations", "/guests", "/inventory"] },
  { role: "housekeeping",
    allow: ["/housekeeping", "/rooms", "/calendar"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/reservations", "/guests"] },
  { role: "storekeeper",
    allow: ["/inventory"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/rooms", "/reservations", "/housekeeping"] },
  { role: "guest_relations",
    allow: ["/reservations", "/calendar", "/guests", "/rooms"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/inventory", "/housekeeping", "/channels"] },
  { role: "security",
    allow: ["/rooms", "/calendar"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/inventory", "/housekeeping", "/reservations", "/guests"] },
  { role: "maintenance",
    allow: ["/rooms", "/housekeeping"],
    deny: ["/admin", "/pos", "/accounting", "/reports", "/inventory", "/reservations", "/guests"] },
  { role: "hr",
    allow: ["/admin", "/settings/roles"],
    deny: ["/admin/backup", "/admin/uploads", "/pos", "/accounting", "/reports", "/settings/roles-matrix", "/rooms"] },
];

describe("ROUTE_ROLE_MAP × built-in roles", () => {
  for (const { role, allow, deny } of CASES) {
    for (const p of allow) {
      it(`${role} CAN open ${p}`, () => {
        expect(isAllowed(p, rows(role), PROP)).toBe(true);
      });
    }
    for (const p of deny) {
      it(`${role} cannot open ${p}`, () => {
        expect(isAllowed(p, rows(role), PROP)).toBe(false);
      });
    }
  }

  it("wrong-property scope blocks a scoped role", () => {
    expect(isAllowed("/pos", rows("cashier", PROP), "other-property")).toBe(false);
  });
  it("null (global) scope grants across properties", () => {
    expect(isAllowed("/pos", rows("cashier", null), "other-property")).toBe(true);
  });
  it("super_admin bypasses required-role set", () => {
    expect(isAllowed("/admin/backup", rows("super_admin", null), PROP)).toBe(true);
  });
  it("unmapped route falls through to authenticated-only", () => {
    expect(isAllowed("/dashboard", rows("waiter"), PROP)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Cross-property scope tests
 *
 * A role granted for Property A must NOT grant access when the active
 * property is Property B. `super_admin` and rows with a null (global)
 * property_id are the only bypasses. Multi-property users (two rows,
 * one per property) get access on either.
 * ------------------------------------------------------------------ */
describe("cross-property scope enforcement", () => {
  const PROP_A = "prop-A";
  const PROP_B = "prop-B";

  // Every non-super role that maps to at least one route prefix.
  const SCOPED_ROLES: { role: AppRole; route: string }[] = [
    { role: "hotel_owner",             route: "/accounting" },
    { role: "general_manager",         route: "/reports" },
    { role: "front_desk",              route: "/reservations" },
    { role: "reservations",            route: "/channels" },
    { role: "cashier",                 route: "/pos" },
    { role: "restaurant_manager",      route: "/pos" },
    { role: "waiter",                  route: "/pos" },
    { role: "kitchen",                 route: "/pos" },
    { role: "accountant",              route: "/accounting/sync" },
    { role: "auditor",                 route: "/admin/audit" },
    { role: "housekeeping_supervisor", route: "/housekeeping" },
    { role: "housekeeping",            route: "/housekeeping" },
    { role: "storekeeper",             route: "/inventory" },
    { role: "guest_relations",         route: "/guests" },
    { role: "security",                route: "/rooms" },
    { role: "maintenance",             route: "/housekeeping" },
    { role: "hr",                      route: "/admin" },
  ];

  for (const { role, route } of SCOPED_ROLES) {
    it(`${role} scoped to Property A CAN open ${route} on Property A`, () => {
      expect(isAllowed(route, rows(role, PROP_A), PROP_A)).toBe(true);
    });
    it(`${role} scoped to Property A CANNOT open ${route} on Property B`, () => {
      expect(isAllowed(route, rows(role, PROP_A), PROP_B)).toBe(false);
    });
    it(`${role} with global (null) scope CAN open ${route} on Property B`, () => {
      expect(isAllowed(route, rows(role, null), PROP_B)).toBe(true);
    });
    it(`${role} granted on both properties CAN open ${route} on Property B`, () => {
      const multi = [
        { role, property_id: PROP_A },
        { role, property_id: PROP_B },
      ];
      expect(isAllowed(route, multi, PROP_B)).toBe(true);
    });
  }

  it("super_admin scoped to Property A still opens routes on Property B", () => {
    // super_admin short-circuits regardless of property_id.
    expect(isAllowed("/admin/backup", rows("super_admin", PROP_A), PROP_B)).toBe(true);
  });

  it("cashier on Property A is blocked from /pos when active property is null", () => {
    expect(isAllowed("/pos", rows("cashier", PROP_A), null)).toBe(false);
  });

  it("mixed roles: front_desk on A + accountant on B — /accounting only on B", () => {
    const mixed = [
      { role: "front_desk" as AppRole, property_id: PROP_A },
      { role: "accountant" as AppRole, property_id: PROP_B },
    ];
    expect(isAllowed("/accounting", mixed, PROP_A)).toBe(false);
    expect(isAllowed("/accounting", mixed, PROP_B)).toBe(true);
    expect(isAllowed("/reservations", mixed, PROP_A)).toBe(true);
    expect(isAllowed("/reservations", mixed, PROP_B)).toBe(false);
  });

  it("unmapped route is not gated by property scope", () => {
    // No required roles ⇒ authenticated-only, property_id is irrelevant.
    expect(isAllowed("/dashboard", rows("cashier", PROP_A), PROP_B)).toBe(true);
  });
});
