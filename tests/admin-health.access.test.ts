/**
 * /admin/health RBAC test — only Admin roles may access the Health Dashboard.
 * Run:  bunx vitest run tests/admin-health.access.test.ts
 */
import { describe, it, expect } from "vitest";
import { isAllowed, requiredRolesFor } from "@/lib/admin/route-permissions";
import { ADMIN_ROLES } from "@/lib/admin/permissions";
import type { AppRole } from "@/hooks/use-user-roles";

const PROP = "prop-1";
const rows = (role: AppRole, property: string | null = PROP) => [
  { role, property_id: property },
];

const ROUTE = "/admin/health";

// Every non-admin role currently defined in the RBAC matrix.
const NON_ADMIN_ROLES: AppRole[] = [
  "manager",
  "front_desk",
  "reservations",
  "cashier",
  "restaurant_manager",
  "waiter",
  "kitchen",
  "accountant",
  "auditor",
  "housekeeping_supervisor",
  "housekeeping",
  "storekeeper",
  "guest_relations",
  "security",
  "maintenance",
  "hr",
];

describe("/admin/health access control", () => {
  it("is mapped to ADMIN_ROLES exactly", () => {
    const required = requiredRolesFor(ROUTE);
    expect(required).not.toBeNull();
    expect(new Set(required!)).toEqual(new Set(ADMIN_ROLES));
  });

  it("longest-prefix wins over the generic /admin rule", () => {
    // /admin allows hr, but /admin/health must NOT.
    expect(isAllowed(ROUTE, rows("hr"), PROP)).toBe(false);
    expect(isAllowed("/admin", rows("hr"), PROP)).toBe(true);
  });

  for (const role of ADMIN_ROLES) {
    it(`admin role ${role} CAN open ${ROUTE}`, () => {
      expect(isAllowed(ROUTE, rows(role), PROP)).toBe(true);
    });
    it(`admin role ${role} CAN open nested ${ROUTE}/details`, () => {
      expect(isAllowed(`${ROUTE}/details`, rows(role), PROP)).toBe(true);
    });
  }

  for (const role of NON_ADMIN_ROLES) {
    it(`non-admin role ${role} is DENIED ${ROUTE}`, () => {
      expect(isAllowed(ROUTE, rows(role), PROP)).toBe(false);
    });
    it(`non-admin role ${role} is DENIED nested ${ROUTE}/details`, () => {
      expect(isAllowed(`${ROUTE}/details`, rows(role), PROP)).toBe(false);
    });
  }

  it("super_admin bypass works even when scoped to a different property", () => {
    expect(isAllowed(ROUTE, rows("super_admin", "other-prop"), PROP)).toBe(true);
  });

  it("admin role scoped to Property A is blocked on Property B", () => {
    expect(isAllowed(ROUTE, rows("hotel_owner", "prop-A"), "prop-B")).toBe(false);
  });

  it("admin role with global (null) scope works on any property", () => {
    expect(isAllowed(ROUTE, rows("general_manager", null), "any-prop")).toBe(true);
  });

  it("user with no roles is denied", () => {
    expect(isAllowed(ROUTE, [], PROP)).toBe(false);
  });
});
