import { describe, expect, it } from "vitest";
import {
  IDENTIFIER_PATTERN,
  normalizeIdentifier,
  validateIdentifier,
  validatePassword,
} from "@/lib/auth-identity";

describe("Staff/Admin identifiers", () => {
  it.each([
    "Ebenezer.Agyekum",
    "FrontDesk@1",
    "NIGHT-MANAGER",
    "Accounts_01",
    "STF-001",
    "ADMIN-001",
    "Admin@Head",
  ])("accepts %s", (value) => expect(validateIdentifier(value)).toBe(value));

  it("trims only surrounding identifier spaces", () => {
    expect(validateIdentifier("  STF-001  ")).toBe("STF-001");
    expect(() => validateIdentifier("STF 001")).toThrow();
  });

  it("normalizes case-only duplicates to the same database key", () => {
    expect(normalizeIdentifier("Admin@Head")).toBe(normalizeIdentifier("admin@head"));
  });

  it("rejects unapproved identifier symbols", () => {
    expect(IDENTIFIER_PATTERN.test("staff+one")).toBe(false);
  });
});

describe("password contract", () => {
  it("accepts password-manager symbols and preserves exact case", () => {
    const password = "Hotel!Desk#2026";
    expect(validatePassword(password)).toBe(password);
    expect(() => validatePassword(password.toLowerCase())).toThrow();
  });

  it.each(["Short1!", "lowercase123!", "UPPERCASE123!", "NoNumbers!!", "NoSymbols123A"])(
    "rejects %s",
    (password) => expect(() => validatePassword(password)).toThrow(),
  );
});
