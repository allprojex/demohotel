/**
 * /api/public/health payload safety test.
 *
 * The health endpoint is UNAUTHENTICATED (mounted under /api/public/*) so its
 * response is what a non-admin — including an anonymous caller — sees. This
 * suite pins that payload shape and guarantees it NEVER carries admin-only
 * data: remediation steps, stack traces, secret values, or fields not on the
 * public allow-list.
 *
 * Run:  bunx vitest run tests/health.public-payload.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Route } from "@/routes/api/public/health";

const HEALTH_SRC = readFileSync(
  join(process.cwd(), "src/routes/api/public/health.ts"),
  "utf8",
);
const ADMIN_PAGE_SRC = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/admin_.health.tsx"),
  "utf8",
);

// Allow-list of top-level keys the public payload is EVER allowed to expose.
const ALLOWED_TOP_KEYS = new Set([
  "status",
  "version",
  "node",
  "startedAt",
  "timestamp",
  "checks",
]);

// Allow-list of per-check keys.
const ALLOWED_CHECK_KEYS = new Set(["ok", "ms", "detail"]);

// Field names that would indicate admin-only or internal data leaking through.
const FORBIDDEN_FIELD_NAMES = [
  "remediation",
  "remediationSteps",
  "steps",
  "fix",
  "howToFix",
  "howTo",
  "stack",
  "stackTrace",
  "trace",
  "hint",
  "sql",
  "query",
  "token",
  "apiKey",
  "secret",
  "password",
  "privateKey",
  "serviceRoleKey",
  "SUPABASE_SERVICE_ROLE_KEY",
  "envVars",
  "process",
  "config",
];

// Substrings that must never appear anywhere in the serialised payload.
const FORBIDDEN_VALUE_PATTERNS: (string | RegExp)[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "SUPABASE_PUBLISHABLE_KEY=",
  "SUPABASE_URL=",
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT
  /sb_secret_[A-Za-z0-9]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /at\s+\S+\s+\(.*:\d+:\d+\)/, // node stack-trace frame
  /Error:\s.*\n\s+at\s/,       // multi-line stack
];

function collectKeys(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

async function invokeHealth(): Promise<{ status: number; body: any; raw: string }> {
  const handler = (Route.options as any).server.handlers.GET;
  expect(typeof handler).toBe("function");
  const res: Response = await handler({
    request: new Request("http://localhost/api/public/health"),
  });
  const raw = await res.text();
  return { status: res.status, body: JSON.parse(raw), raw };
}

describe("/api/public/health — non-admin payload never leaks sensitive fields", () => {
  let status: number;
  let body: any;
  let raw: string;

  beforeAll(async () => {
    // Force env-missing so the DB check is short-circuited and we never make
    // a real network call from CI. This exercises the failure-shape too.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    ({ status, body, raw } = await invokeHealth());
  });

  it("responds with JSON and a non-cacheable status", () => {
    expect([200, 503]).toContain(status);
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });

  it("top-level keys are limited to the public allow-list", () => {
    const extra = Object.keys(body).filter((k) => !ALLOWED_TOP_KEYS.has(k));
    expect(extra).toEqual([]);
  });

  it("checks entries only contain { ok, ms?, detail? }", () => {
    expect(body.checks && typeof body.checks).toBe("object");
    for (const [name, check] of Object.entries<any>(body.checks)) {
      expect(typeof check.ok, `${name}.ok`).toBe("boolean");
      const extra = Object.keys(check).filter((k) => !ALLOWED_CHECK_KEYS.has(k));
      expect(extra, `unexpected keys on check ${name}: ${extra.join(",")}`).toEqual([]);
      if ("ms" in check) expect(typeof check.ms).toBe("number");
      if ("detail" in check) expect(typeof check.detail).toBe("string");
    }
  });

  it("no forbidden field names appear anywhere in the payload", () => {
    const keys = collectKeys(body);
    const leaked = FORBIDDEN_FIELD_NAMES.filter((f) => keys.has(f));
    expect(leaked, `leaked fields: ${leaked.join(",")}`).toEqual([]);
  });

  it("no remediation / how-to-fix guidance appears in the raw JSON", () => {
    const lower = raw.toLowerCase();
    for (const needle of [
      "remediation",
      "how to fix",
      "howtofix",
      "steps to fix",
      "systemctl",
      "journalctl",
      "sudo ",
      "/opt/infinity-pms",
      ".env",
    ]) {
      expect(lower.includes(needle), `payload leaks remediation hint: "${needle}"`).toBe(false);
    }
  });

  it("no secret material or stack-trace patterns appear in the raw JSON", () => {
    for (const p of FORBIDDEN_VALUE_PATTERNS) {
      if (typeof p === "string") {
        expect(raw.includes(p), `payload leaks value: "${p}"`).toBe(false);
      } else {
        expect(p.test(raw), `payload matches forbidden pattern ${p}`).toBe(false);
      }
    }
  });

  it("detail strings stay short (no dumped error objects or stacks)", () => {
    for (const [name, check] of Object.entries<any>(body.checks)) {
      if (typeof check.detail === "string") {
        expect(check.detail.length, `${name}.detail too long`).toBeLessThan(200);
        expect(check.detail.includes("\n"), `${name}.detail contains newline`).toBe(false);
      }
    }
  });

  it("degraded response (env missing) still keeps the same safe shape", () => {
    expect(body.status).toBe("degraded");
    expect(status).toBe(503);
    expect(body.checks.env.ok).toBe(false);
    // The env check may name which vars are missing — that's a design choice,
    // but it must NOT include their values.
    expect(body.checks.env.detail).not.toMatch(/=/);
    expect(body.checks.database.ok).toBe(false);
  });
});

describe("remediation guidance is admin-only (source code assertion)", () => {
  it("remediation copy exists in the admin dashboard component", () => {
    expect(ADMIN_PAGE_SRC).toMatch(/REMEDIATION/);
    expect(ADMIN_PAGE_SRC).toMatch(/systemctl|journalctl|\.env/);
  });

  it("the public health endpoint source contains no remediation copy", () => {
    const lowered = HEALTH_SRC.toLowerCase();
    for (const needle of [
      "remediation",
      "systemctl",
      "journalctl",
      "sudo ",
      "/opt/infinity-pms",
      "how to fix",
    ]) {
      expect(lowered.includes(needle), `health.ts leaks admin copy: "${needle}"`).toBe(false);
    }
  });

  it("the public health endpoint does not import the admin remediation map", () => {
    expect(HEALTH_SRC).not.toMatch(/REMEDIATION/);
    expect(HEALTH_SRC).not.toMatch(/admin_\.health/);
  });
});
