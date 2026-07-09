import { createFileRoute } from "@tanstack/react-router";
import { runDueSchedules } from "@/lib/backup.server";

/**
 * Cron dispatcher — runs due backup schedules.
 * Auth: `x-cron-secret` header (or `Authorization: Bearer …`) must match CRON_SECRET.
 * NOTE: never authenticate cron endpoints with the Supabase publishable key —
 * that value is shipped in the client bundle.
 */
export const Route = createFileRoute("/api/public/hooks/backup-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(JSON.stringify({ error: "Server misconfigured" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const auth = request.headers.get("authorization");
        const provided =
          request.headers.get("x-cron-secret") ??
          (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
        if (!provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const res = await runDueSchedules();
          return new Response(JSON.stringify({ ok: true, ...res }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
