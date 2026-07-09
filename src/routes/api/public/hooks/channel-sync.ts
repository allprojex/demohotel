import { createFileRoute } from "@tanstack/react-router";

// Scheduled endpoint hit by pg_cron every 15 minutes. Runs the mock sync
// (push ARI + pull reservations) for every active channel across all properties.
// Uses the service-role client server-side; no user session required.
export const Route = createFileRoute("/api/public/hooks/channel-sync")({
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

        const { data: channels, error } = await supabaseAdmin
          .from("channels")
          .select("id, property_id, name")
          .eq("is_active", true);
        if (error) return new Response(error.message, { status: 500 });

        let ok = 0, fail = 0, queued = 0;

        for (const ch of channels ?? []) {
          try {
            await supabaseAdmin.from("channels").update({ last_sync_status: "syncing" }).eq("id", ch.id);
            // push ARI
            const pushMs = 200 + Math.floor(Math.random() * 700);
            const pushOk = Math.random() > 0.05;
            await supabaseAdmin.from("channel_sync_logs").insert({
              channel_id: ch.id, property_id: ch.property_id, direction: "push_ari",
              status: pushOk ? "success" : "failed", duration_ms: pushMs,
              message: pushOk ? "Scheduled ARI push (30d)" : "Simulated push failure",
              payload: { scheduled: true },
            });
            // pull reservations
            const pullMs = 200 + Math.floor(Math.random() * 700);
            const pullOk = Math.random() > 0.03;
            let localQueued = 0;
            if (pullOk) {
              const count = Math.floor(Math.random() * 2);
              for (let i = 0; i < count; i++) {
                const start = new Date(Date.now() + Math.floor(Math.random() * 30) * 86400000);
                const nights = 1 + Math.floor(Math.random() * 4);
                const end = new Date(start.getTime() + nights * 86400000);
                const iso = (d: Date) => d.toISOString().slice(0, 10);
                const ref = `BDC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
                const { error: qErr } = await supabaseAdmin.from("channel_reservations_queue").insert({
                  channel_id: ch.id, property_id: ch.property_id, external_ref: ref,
                  payload: {
                    external_ref: ref, first_name: "OTA", last_name: "Guest",
                    email: `guest${Date.now()}@example.com`, phone: null,
                    check_in: iso(start), check_out: iso(end),
                    adults: 2, children: 0, total: nights * 120,
                  },
                });
                if (!qErr) localQueued++;
              }
              queued += localQueued;
            }
            await supabaseAdmin.from("channel_sync_logs").insert({
              channel_id: ch.id, property_id: ch.property_id, direction: "pull_reservations",
              status: pullOk ? "success" : "failed", duration_ms: pullMs,
              message: pullOk ? `Pulled ${localQueued} reservation(s)` : "Simulated pull failure",
              payload: { queued: localQueued },
            });
            const anyFail = !pushOk || !pullOk;
            await supabaseAdmin.from("channels").update({
              last_sync_at: new Date().toISOString(),
              last_sync_status: anyFail ? "failed" : "success",
              last_sync_error: anyFail ? "Some operations failed" : null,
            }).eq("id", ch.id);
            if (anyFail) fail++; else ok++;
          } catch (e) {
            fail++;
            await supabaseAdmin.from("channels").update({
              last_sync_status: "failed", last_sync_error: (e as Error).message,
            }).eq("id", ch.id);
          }
        }

        return Response.json({ ok, fail, queued, total: channels?.length ?? 0 });
      },
    },
  },
});
