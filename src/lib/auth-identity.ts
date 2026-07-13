export type LoginAccountType = "staff" | "admin";

export const IDENTIFIER_PATTERN = /^[A-Za-z0-9._@-]+$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/;

export function normalizeIdentifier(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function validateIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 80 || !IDENTIFIER_PATTERN.test(trimmed)) {
    throw new Error(
      "Use 3–80 letters, numbers, dots, underscores, hyphens or @ symbols with no spaces.",
    );
  }
  return trimmed;
}

export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

export function validateLoginCredential(value: string, accountType: LoginAccountType): string {
  const trimmed = value.trim();
  if (accountType === "admin" && isEmailAddress(trimmed)) return trimmed;
  return validateIdentifier(trimmed);
}

export function validatePassword(value: string): string {
  if (!PASSWORD_PATTERN.test(value)) {
    throw new Error(
      "Password must be at least 10 characters and include uppercase, lowercase, a number and a symbol.",
    );
  }
  return value;
}
