import { createFileRoute } from "@tanstack/react-router";
import { runScheduledExport } from "@/lib/analytics-exports.server";

// Runs due analytics_export_schedules (next_run_at <= now, is_active).
// Authenticated with CRON_SECRET (same pattern as accounting-sync).
// The anon key CANNOT be used here — it's embedded in the client bundle and
// would let any internet user trigger scheduled exports and spam emails.
export const Route = createFileRoute("/api/public/hooks/analytics-exports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-cron-secret") ??
          (request.headers.get("authorization")?.startsWith("Bearer ")
            ? request.headers.get("authorization")!.slice(7)
            : null);
        if (!provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("analytics_export_schedules")
          .select("id")
          .eq("is_active", true)
          .lte("next_run_at", nowIso);
        if (error) return new Response(error.message, { status: 500 });

        let ok = 0, fail = 0;
        for (const s of due ?? []) {
          try {
            const r = await runScheduledExport(s.id);
            if (r.status === "sent") ok++; else fail++;
          } catch { fail++; }
        }
        return Response.json({ total: due?.length ?? 0, ok, fail, at: nowIso });
      },
    },
  },
});
