// Test-only RBAC login harness.
//
// Guarded by TEST_HARNESS_SECRET (server-side env). Callers use this to mint
// authenticated Supabase users with specific role/property assignments so
// Playwright can drive true cross-property RBAC end-to-end tests without a
// service-role key on the client side.
//
// Actions (POST body { action, ... }):
//   "setup"        → ensure two test properties exist; returns { propertyA, propertyB }
//   "ensureUser"   → { email, password, roles: [{role, property_id|null}] }
//                    creates or updates an auth user and replaces their user_roles rows
//   "cleanup"      → removes any users with email ending in "@rbac.test" and the
//                    two test properties
//
// All operations require header `x-harness-secret: <TEST_HARNESS_SECRET>`.
//
// Every branch returns a JSON envelope. Failures return
//   { ok: false, op, error, code?, hint?, details? }
// with a matching server-side [srv:*] log line, so the failing condition is
// always visible in both the response body and the worker/dev logs.
import { createFileRoute } from "@tanstack/react-router";
import { httpError, httpErrorFrom, logInfo, runServerOp } from "@/lib/server/errors.server";

const PROP_A_NAME = "RBAC Harness — Property A";
const PROP_B_NAME = "RBAC Harness — Property B";
const PROP_A_CODE = "RBAC-A";
const PROP_B_CODE = "RBAC-B";
const TEST_EMAIL_DOMAIN = "@rbac.test";

async function ensureProperty(admin: any, name: string, code: string) {
  const { data: existing, error: selErr } = await admin
    .from("properties").select("id").eq("code", code).maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as string;
  const { data, error } = await admin
    .from("properties").insert({ name, code, is_public: false, active: true })
    .select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function findUserByEmail(admin: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export const Route = createFileRoute("/api/public/test/rbac-harness")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Hard opt-in gate: this endpoint is disabled by default and must
        // never be reachable in production. It only activates when BOTH
        // TEST_HARNESS_ENABLED === "1" AND TEST_HARNESS_SECRET are set on
        // the server, and NODE_ENV is not "production". Any other config
        // (including a leaked secret alone) returns 410 Gone so the route
        // is effectively removed.
        const enabled = process.env.TEST_HARNESS_ENABLED === "1";
        const nodeEnv = process.env.NODE_ENV;
        const expected = process.env.TEST_HARNESS_SECRET;
        if (!enabled || nodeEnv === "production" || !expected) {
          return httpError(410, "harness.disabled",
            "Test RBAC harness is disabled in this environment");
        }
        const provided = request.headers.get("x-harness-secret") ?? "";
        if (provided !== expected) {
          return httpError(401, "harness.gate",
            "Invalid or missing x-harness-secret header");
        }


        let body: any;
        try {
          body = await request.json();
        } catch (e) {
          return httpErrorFrom(400, "harness.parse", e);
        }
        if (!body || typeof body.action !== "string") {
          return httpError(400, "harness.parse",
            "Body must be JSON with a string `action` field",
            { received: typeof body });
        }

        const action = body.action as string;
        const op = `harness.${action}`;
        logInfo({ op, phase: "request" }, {
          email: body.email ? String(body.email).slice(0, 80) : undefined,
          roles: Array.isArray(body.roles) ? body.roles.length : undefined,
        });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          if (action === "setup") {
            const out = await runServerOp({ op }, async () => {
              const propertyA = await ensureProperty(supabaseAdmin, PROP_A_NAME, PROP_A_CODE);
              const propertyB = await ensureProperty(supabaseAdmin, PROP_B_NAME, PROP_B_CODE);
              return { propertyA, propertyB };
            });
            return Response.json({ ok: true, ...out });
          }

          if (action === "ensureUser") {
            const email = String(body.email ?? "").toLowerCase();
            const password = String(body.password ?? "");
            const roles: { role: string; property_id: string | null }[] = Array.isArray(body.roles) ? body.roles : [];

            if (!email.endsWith(TEST_EMAIL_DOMAIN)) {
              return httpError(400, op,
                `Harness emails must end with ${TEST_EMAIL_DOMAIN}`,
                { email });
            }
            if (password.length < 8) {
              return httpError(400, op, "Password must be at least 8 characters",
                { length: password.length });
            }
            for (const r of roles) {
              if (!r || typeof r.role !== "string") {
                return httpError(400, op, "Each role entry needs a string `role`", { entry: r });
              }
              if (r.property_id !== null && typeof r.property_id !== "string") {
                return httpError(400, op,
                  "Each role entry needs `property_id` (string) or null", { entry: r });
              }
            }

            const result = await runServerOp({ op, email, roleCount: roles.length }, async () => {
              let userId = await findUserByEmail(supabaseAdmin, email);
              if (userId) {
                const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
                  password, email_confirm: true,
                });
                if (error) throw error;
              } else {
                const { data, error } = await supabaseAdmin.auth.admin.createUser({
                  email, password, email_confirm: true,
                });
                if (error) throw error;
                userId = data.user!.id;
              }

              const { error: profErr } = await (supabaseAdmin.from("profiles") as any).upsert(
                { id: userId, full_name: email, status: "active", approved_at: new Date().toISOString() },
                { onConflict: "id" },
              );
              if (profErr) throw profErr;

              const { error: delErr } = await supabaseAdmin.from("user_roles")
                .delete().eq("user_id", userId);
              if (delErr) throw delErr;

              if (roles.length > 0) {
                const rows = roles.map((r) => ({
                  user_id: userId as string,
                  role: r.role as any,
                  property_id: r.property_id,
                }));
                const { error: insErr } = await (supabaseAdmin.from("user_roles") as any).insert(rows);
                if (insErr) throw insErr;
              }

              return { userId };
            });
            return Response.json({ ok: true, ...result });
          }

          if (action === "cleanup") {
            const result = await runServerOp({ op }, async () => {
              let removed = 0;
              for (let page = 1; page <= 5; page++) {
                const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
                if (error) throw error;
                const testUsers = data.users.filter((u: any) =>
                  (u.email ?? "").toLowerCase().endsWith(TEST_EMAIL_DOMAIN),
                );
                for (const u of testUsers) {
                  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
                  if (delErr) throw delErr;
                  removed++;
                }
                if (data.users.length < 200) break;
              }
              const { error: propErr } = await supabaseAdmin.from("properties")
                .delete().in("code", [PROP_A_CODE, PROP_B_CODE]);
              if (propErr) throw propErr;
              return { removed };
            });
            return Response.json({ ok: true, ...result });
          }

          return httpError(400, "harness.dispatch", `Unknown action: ${action}`);
        } catch (e) {
          return httpErrorFrom(500, op, e);
        }
      },
    },
  },
});
