import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "crypto";

// Nightly cron: for every active sync target, push previous day's journal summary
// to its configured webhook_url. Called by pg_cron with an X-Cron-Secret header.
export const Route = createFileRoute("/api/public/hooks/accounting-sync")({
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
        const { data: targets, error } = await supabaseAdmin
          .from("accounting_sync_targets")
          .select("id, property_id, webhook_url, signing_secret")
          .eq("is_active", true);
        if (error) return new Response(error.message, { status: 500 });

        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let ok = 0, fail = 0;

        for (const t of targets ?? []) {
          const { data: run } = await supabaseAdmin.from("accounting_sync_runs").insert({
            target_id: t.id, property_id: t.property_id,
            from_date: yesterday, to_date: yesterday, status: "running",
          }).select().single();
          try {
            const { data: rows, error: sErr } = await supabaseAdmin.rpc("accounting_daily_summary", {
              _property_id: t.property_id, _from: yesterday, _to: yesterday,
            });
            // RPC has SECURITY DEFINER but has_any_role check on auth.uid() will be null; use direct query instead.
            let summary = rows ?? [];
            if (sErr || summary.length === 0) {
              const { data: direct } = await supabaseAdmin
                .from("journal_lines")
                .select("debit_base, credit_base, entry_id, accounts!inner(code,name,type), journal_entries!inner(entry_date, property_id)")
                .eq("journal_entries.property_id", t.property_id)
                .gte("journal_entries.entry_date", yesterday)
                .lte("journal_entries.entry_date", yesterday);
              const agg = new Map<string, any>();
              for (const r of direct ?? []) {
                const a: any = (r as any).accounts;
                const key = `${(r as any).journal_entries.entry_date}|${a.code}`;
                const existing = agg.get(key) ?? {
                  entry_date: (r as any).journal_entries.entry_date,
                  account_code: a.code, account_name: a.name, account_type: a.type,
                  debit_base: 0, credit_base: 0, entries_count: new Set<string>(),
                };
                existing.debit_base += Number((r as any).debit_base ?? 0);
                existing.credit_base += Number((r as any).credit_base ?? 0);
                existing.entries_count.add((r as any).entry_id);
                agg.set(key, existing);
              }
              summary = Array.from(agg.values()).map((v: any) => ({
                ...v, entries_count: v.entries_count.size,
              }));
            }

            const header = "entry_date,account_code,account_name,account_type,debit_base,credit_base,entries_count";
            const lines = [header, ...summary.map((r: any) => [
              r.entry_date, r.account_code, r.account_name, r.account_type,
              r.debit_base, r.credit_base, r.entries_count,
            ].join(","))];
            const csv = lines.join("\n");

            let respStatus: number | null = null;
            let respBody: string | null = null;
            if (t.webhook_url) {
              const body = JSON.stringify({
                property_id: t.property_id, from: yesterday, to: yesterday, rows: summary, csv,
              });
              const sig = createHmac("sha256", t.signing_secret).update(body).digest("hex");
              const res = await fetch(t.webhook_url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Signature": sig, "X-Property-Id": t.property_id },
                body,
              });
              respStatus = res.status;
              respBody = (await res.text()).slice(0, 4000);
              if (!res.ok) throw new Error(`Webhook ${res.status}: ${respBody.slice(0, 200)}`);
            }

            await supabaseAdmin.from("accounting_sync_runs").update({
              status: "success", entries_count: summary.length, csv_payload: csv,
              response_status: respStatus, response_body: respBody, finished_at: new Date().toISOString(),
            }).eq("id", run!.id);
            await supabaseAdmin.from("accounting_sync_targets").update({
              last_sync_at: new Date().toISOString(), last_sync_status: "success", last_sync_error: null,
            }).eq("id", t.id);
            ok++;
          } catch (e) {
            const msg = (e as Error).message;
            await supabaseAdmin.from("accounting_sync_runs").update({
              status: "failed", error: msg, finished_at: new Date().toISOString(),
            }).eq("id", run!.id);
            await supabaseAdmin.from("accounting_sync_targets").update({
              last_sync_at: new Date().toISOString(), last_sync_status: "failed", last_sync_error: msg,
            }).eq("id", t.id);
            fail++;
          }
        }

        return Response.json({ ok, fail, total: targets?.length ?? 0, date: yesterday });
      },
    },
  },
});
