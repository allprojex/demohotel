import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";
import { assertSafeOutboundUrl } from "@/lib/server/url-guard";

type SummaryRow = {
  entry_date: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_base: number;
  credit_base: number;
  entries_count: number;
};

function toCsv(rows: SummaryRow[]): string {
  const header = ["entry_date","account_code","account_name","account_type","debit_base","credit_base","entries_count"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.entry_date, r.account_code, r.account_name, r.account_type,
      r.debit_base, r.credit_base, r.entries_count,
    ].map(escape).join(","));
  }
  return lines.join("\n");
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

async function performSync(supabase: any, target: {
  id: string; property_id: string; webhook_url: string | null; signing_secret: string;
}, fromDate: string, toDate: string, triggeredBy: string | null) {
  const { data: run, error: runErr } = await supabase.from("accounting_sync_runs").insert({
    target_id: target.id, property_id: target.property_id,
    from_date: fromDate, to_date: toDate, status: "running", triggered_by: triggeredBy,
  }).select().single();
  if (runErr) throw new Error(runErr.message);

  try {
    const { data: rows, error: sumErr } = await supabase.rpc("accounting_daily_summary", {
      _property_id: target.property_id, _from: fromDate, _to: toDate,
    });
    if (sumErr) throw new Error(sumErr.message);
    const summary = (rows ?? []) as SummaryRow[];
    const csv = toCsv(summary);
    const entriesCount = summary.reduce((n, r) => Math.max(n, r.entries_count), 0);

    let responseStatus: number | null = null;
    let responseBody: string | null = null;

    if (target.webhook_url) {
      assertSafeOutboundUrl(target.webhook_url);
      const body = JSON.stringify({
        property_id: target.property_id,
        from: fromDate, to: toDate,
        rows: summary,
        csv,
      });
      const sig = createHmac("sha256", target.signing_secret).update(body).digest("hex");
      const res = await fetch(target.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": sig,
          "X-Property-Id": target.property_id,
        },
        body,
      });
      responseStatus = res.status;
      responseBody = (await res.text()).slice(0, 4000);
      if (!res.ok) throw new Error(`Webhook responded ${res.status}: ${responseBody.slice(0, 200)}`);
    }

    await supabase.from("accounting_sync_runs").update({
      status: "success", entries_count: entriesCount, csv_payload: csv,
      response_status: responseStatus, response_body: responseBody, finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    await supabase.from("accounting_sync_targets").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "success", last_sync_error: null,
    }).eq("id", target.id);
    return { runId: run.id, status: "success", entriesCount };
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("accounting_sync_runs").update({
      status: "failed", error: msg, finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    await supabase.from("accounting_sync_targets").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "failed", last_sync_error: msg,
    }).eq("id", target.id);
    return { runId: run.id, status: "failed", error: msg };
  }
}

export const runAccountingSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { targetId: string; fromDate?: string; toDate?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: target, error } = await supabase.from("accounting_sync_targets")
      .select("id, property_id, webhook_url, signing_secret").eq("id", data.targetId).maybeSingle();
    if (error || !target) throw new Error("Sync target not found");
    const yesterday = new Date(Date.now() - 86400000);
    const from = data.fromDate ?? isoDate(yesterday);
    const to = data.toDate ?? isoDate(yesterday);
    return performSync(supabase, target, from, to, userId);
  });

export const retryFailedSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: run, error } = await supabase.from("accounting_sync_runs")
      .select("target_id, from_date, to_date").eq("id", data.runId).maybeSingle();
    if (error || !run) throw new Error("Run not found");
    const { data: target, error: tErr } = await supabase.from("accounting_sync_targets")
      .select("id, property_id, webhook_url, signing_secret").eq("id", run.target_id).maybeSingle();
    if (tErr || !target) throw new Error("Sync target not found");
    return performSync(supabase, target, run.from_date, run.to_date, userId);
  });

export const getSyncRunCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase.from("accounting_sync_runs")
      .select("csv_payload, from_date, to_date").eq("id", data.runId).maybeSingle();
    if (error || !run) throw new Error("Run not found");
    return { csv: run.csv_payload ?? "", fromDate: run.from_date, toDate: run.to_date };
  });

/** Sends a signed sample payload to the target's webhook and records the result as a test run. */
export const testSyncWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { targetId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: target, error } = await supabase.from("accounting_sync_targets")
      .select("id, property_id, webhook_url, signing_secret").eq("id", data.targetId).maybeSingle();
    if (error || !target) throw new Error("Sync target not found");
    if (!target.webhook_url) throw new Error("This target has no webhook URL configured");
    assertSafeOutboundUrl(target.webhook_url);


    const today = new Date().toISOString().slice(0, 10);
    const samplePayload = {
      test: true,
      property_id: target.property_id,
      from: today,
      to: today,
      rows: [
        { entry_date: today, account_code: "1000", account_name: "Cash",
          account_type: "asset", debit_base: 100, credit_base: 0, entries_count: 1 },
        { entry_date: today, account_code: "4000", account_name: "Room Revenue",
          account_type: "revenue", debit_base: 0, credit_base: 100, entries_count: 1 },
      ],
      csv: "entry_date,account_code,account_name,account_type,debit_base,credit_base,entries_count\n" +
           `${today},1000,Cash,asset,100,0,1\n${today},4000,Room Revenue,revenue,0,100,1`,
    };
    const body = JSON.stringify(samplePayload);
    const sig = createHmac("sha256", target.signing_secret).update(body).digest("hex");

    const { data: run, error: runErr } = await supabase.from("accounting_sync_runs").insert({
      target_id: target.id, property_id: target.property_id,
      from_date: today, to_date: today, status: "running",
      triggered_by: userId, is_test: true,
    }).select().single();
    if (runErr) throw new Error(runErr.message);

    try {
      const res = await fetch(target.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": sig,
          "X-Signature-Test": "1",
          "X-Property-Id": target.property_id,
        },
        body,
      });
      const respBody = (await res.text()).slice(0, 4000);
      await supabase.from("accounting_sync_runs").update({
        status: res.ok ? "success" : "failed",
        error: res.ok ? null : `Webhook responded ${res.status}: ${respBody.slice(0, 200)}`,
        entries_count: samplePayload.rows.length,
        csv_payload: samplePayload.csv,
        response_status: res.status,
        response_body: respBody,
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      return { ok: res.ok, status: res.status, body: respBody.slice(0, 400), runId: run.id };
    } catch (e) {
      const msg = (e as Error).message;
      await supabase.from("accounting_sync_runs").update({
        status: "failed", error: msg, finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      return { ok: false, status: 0, body: msg, runId: run.id };
    }
  });
