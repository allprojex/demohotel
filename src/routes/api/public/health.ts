import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Public health probe for load balancers, systemd, Nginx, monitoring tools.
// Returns 200 with { status: "ok" } when the app can reach the database, or
// 503 with a per-check breakdown when something is degraded.
//
// Intentionally leaks no secrets: only booleans, timings and the Node/app
// versions. Safe to expose on the internet.

const APP_VERSION = "1.0.0";
const STARTED_AT = new Date().toISOString();

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const checks: Record<string, { ok: boolean; ms?: number; detail?: string }> = {};

        // 1. Node runtime present
        checks.node = { ok: !!process.versions?.node, detail: process.versions?.node ?? "unknown" };

        // 2. Required env vars
        const requiredEnv = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
        const missing = requiredEnv.filter((k) => !process.env[k]);
        checks.env = { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(",")}` : "ok" };

        // 3. Database reachability via publishable key (RLS-safe, no secrets)
        if (checks.env.ok) {
          const started = Date.now();
          try {
            const sb = createClient(
              process.env.SUPABASE_URL!,
              process.env.SUPABASE_PUBLISHABLE_KEY!,
              { auth: { persistSession: false, autoRefreshToken: false } },
            );
            // get_brand_settings() is a SECURITY DEFINER RPC exposing safe public branding fields.
            const { error } = await sb.rpc("get_brand_settings" as any);
            checks.database = { ok: !error, ms: Date.now() - started, detail: error?.message ?? "ok" };
          } catch (e: any) {
            checks.database = { ok: false, ms: Date.now() - started, detail: String(e?.message ?? e) };
          }
        } else {
          checks.database = { ok: false, detail: "skipped (env missing)" };
        }

        const ok = Object.values(checks).every((c) => c.ok);
        const body = {
          status: ok ? "ok" : "degraded",
          version: APP_VERSION,
          node: process.versions?.node,
          startedAt: STARTED_AT,
          timestamp: new Date().toISOString(),
          checks,
        };
        return new Response(JSON.stringify(body, null, 2), {
          status: ok ? 200 : 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
