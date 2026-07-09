/**
 * Backup runner — server-only helpers.
 * Used by createServerFn calls (admin UI) and by the public cron hook.
 * Uses supabaseAdmin (bypasses RLS) — callers must authorize first.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BACKUP_TABLES } from "./backup.tables";

const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 200_000;
const BUCKET = "backups";

export type ScheduleRow = {
  id: string;
  name: string;
  property_id: string | null;
  scope: "system" | "property";
  kind: "full" | "incremental";
  frequency: "hourly" | "daily" | "weekly" | "monthly";
  hour_utc: number;
  day_of_week: number | null;
  day_of_month: number | null;
  tables: string[] | null;
  retention_count: number;
  enabled: boolean;
  last_run_at: string | null;
  last_snapshot_id: string | null;
  next_run_at: string | null;
};

export function computeNextRun(s: Pick<ScheduleRow, "frequency" | "hour_utc" | "day_of_week" | "day_of_month">, from = new Date()): Date {
  const d = new Date(from);
  if (s.frequency === "hourly") {
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  const target = new Date(d);
  target.setUTCHours(s.hour_utc, 0, 0, 0);
  if (s.frequency === "daily") {
    if (target <= d) target.setUTCDate(target.getUTCDate() + 1);
    return target;
  }
  if (s.frequency === "weekly") {
    const dow = s.day_of_week ?? 1;
    let diff = (dow - target.getUTCDay() + 7) % 7;
    if (diff === 0 && target <= d) diff = 7;
    target.setUTCDate(target.getUTCDate() + diff);
    return target;
  }
  // monthly
  const dom = Math.min(s.day_of_month ?? 1, 28);
  target.setUTCDate(dom);
  if (target <= d) target.setUTCMonth(target.getUTCMonth() + 1);
  return target;
}

/**
 * Fetch rows for one table honoring scope + since (incremental).
 * Falls back gracefully when a filter column doesn't exist.
 */
async function fetchTableRows(table: string, propertyId: string | null, since: string | null): Promise<{ rows: any[]; usedIncremental: boolean; error?: string }> {
  let usedIncremental = false;
  const rows: any[] = [];
  let from = 0;
  while (true) {
    let q = (supabaseAdmin as any).from(table).select("*").range(from, from + PAGE - 1);
    if (propertyId) q = q.eq("property_id", propertyId);
    if (since) { q = q.gt("updated_at", since); usedIncremental = true; }
    let { data, error } = await q;
    if (error && since) {
      // Retry with created_at
      let q2 = (supabaseAdmin as any).from(table).select("*").range(from, from + PAGE - 1);
      if (propertyId) q2 = q2.eq("property_id", propertyId);
      q2 = q2.gt("created_at", since);
      const r2 = await q2;
      data = r2.data; error = r2.error;
      usedIncremental = !error;
    }
    if (error && propertyId) {
      // Retry without property filter (table not property-scoped)
      let q3 = (supabaseAdmin as any).from(table).select("*").range(from, from + PAGE - 1);
      if (since) { q3 = q3.gt("updated_at", since); usedIncremental = true; }
      const r3 = await q3;
      if (r3.error) return { rows: [], usedIncremental: false, error: r3.error.message };
      data = r3.data;
    } else if (error) {
      return { rows: [], usedIncremental: false, error: error.message };
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
    if (rows.length >= MAX_ROWS_PER_TABLE) break;
  }
  return { rows, usedIncremental };
}

export type SnapshotArchive = {
  version: 2;
  createdAt: string;
  kind: "full" | "incremental" | "manual";
  scope: "system" | "property";
  propertyId: string | null;
  since: string | null;
  until: string;
  tables: string[];
  data: Record<string, any[]>;
  counts: Record<string, number>;
};

export async function executeSnapshot(opts: {
  scheduleId?: string | null;
  triggeredBy?: string | null;
  scope: "system" | "property";
  propertyId?: string | null;
  kind: "full" | "incremental" | "manual";
  tables?: string[] | null;
}): Promise<{ snapshotId: string; storagePath: string; sizeBytes: number; rowCount: number; tableCounts: Record<string, number> }> {
  const started = Date.now();
  const until = new Date().toISOString();

  // Insert running snapshot row
  const { data: snap, error: insErr } = await (supabaseAdmin as any).from("backup_snapshots").insert({
    schedule_id: opts.scheduleId ?? null,
    property_id: opts.propertyId ?? null,
    scope: opts.scope,
    kind: opts.kind,
    status: "running",
    triggered_by: opts.triggeredBy ?? null,
    until_at: until,
  }).select("id").single();
  if (insErr) throw new Error(insErr.message);
  const snapshotId = snap.id as string;

  try {
    // Determine since (for incremental)
    let since: string | null = null;
    if (opts.kind === "incremental") {
      const q = (supabaseAdmin as any).from("backup_snapshots")
        .select("until_at")
        .eq("status", "completed")
        .eq("scope", opts.scope);
      if (opts.propertyId) q.eq("property_id", opts.propertyId);
      if (opts.scheduleId) q.eq("schedule_id", opts.scheduleId);
      const { data: last } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      since = last?.until_at ?? null;
    }

    const tables = (opts.tables && opts.tables.length ? opts.tables : BACKUP_TABLES).filter((t: string) => BACKUP_TABLES.includes(t));
    const data: Record<string, any[]> = {};
    const counts: Record<string, number> = {};
    let total = 0;
    for (const t of tables) {
      const { rows, error } = await fetchTableRows(t, opts.propertyId ?? null, since);
      if (error) { counts[t] = -1; continue; }
      if (rows.length) {
        data[t] = rows;
        counts[t] = rows.length;
        total += rows.length;
      } else {
        counts[t] = 0;
      }
    }

    const archive: SnapshotArchive = {
      version: 2,
      createdAt: new Date().toISOString(),
      kind: opts.kind,
      scope: opts.scope,
      propertyId: opts.propertyId ?? null,
      since, until,
      tables, data, counts,
    };

    // Upload to storage
    const scopeSeg = opts.scope === "property" ? `property/${opts.propertyId}` : "system";
    const path = `snapshots/${scopeSeg}/${opts.scheduleId ?? "manual"}/${until.replace(/[:.]/g, "-")}.json`;
    const body = JSON.stringify(archive);
    const bytes = new TextEncoder().encode(body).byteLength;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    // Complete snapshot row
    await (supabaseAdmin as any).from("backup_snapshots").update({
      status: "completed",
      storage_path: path,
      size_bytes: bytes,
      row_count: total,
      table_counts: counts,
      since_at: since,
      duration_ms: Date.now() - started,
    }).eq("id", snapshotId);

    return { snapshotId, storagePath: path, sizeBytes: bytes, rowCount: total, tableCounts: counts };
  } catch (e: any) {
    await (supabaseAdmin as any).from("backup_snapshots").update({
      status: "failed",
      error: String(e?.message ?? e),
      duration_ms: Date.now() - started,
    }).eq("id", snapshotId);
    throw e;
  }
}

export async function pruneRetention(scheduleId: string, keep: number): Promise<number> {
  const { data: old } = await (supabaseAdmin as any).from("backup_snapshots")
    .select("id,storage_path")
    .eq("schedule_id", scheduleId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .range(keep, keep + 500);
  if (!old?.length) return 0;
  const paths = old.map((r: any) => r.storage_path).filter(Boolean);
  if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
  await (supabaseAdmin as any).from("backup_snapshots").delete().in("id", old.map((r: any) => r.id));
  return old.length;
}

export async function runDueSchedules(now = new Date()): Promise<{ ran: number; results: { scheduleId: string; ok: boolean; error?: string }[] }> {
  const nowIso = now.toISOString();
  const { data: due, error } = await (supabaseAdmin as any).from("backup_schedules")
    .select("*")
    .eq("enabled", true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`);
  if (error) throw new Error(error.message);
  const results: { scheduleId: string; ok: boolean; error?: string }[] = [];
  for (const s of (due ?? []) as ScheduleRow[]) {
    try {
      const snap = await executeSnapshot({
        scheduleId: s.id, scope: s.scope, propertyId: s.property_id,
        kind: s.kind, tables: s.tables ?? null,
      });
      await pruneRetention(s.id, s.retention_count);
      const next = computeNextRun(s, now);
      await (supabaseAdmin as any).from("backup_schedules").update({
        last_run_at: nowIso,
        last_snapshot_id: snap.snapshotId,
        next_run_at: next.toISOString(),
      }).eq("id", s.id);
      results.push({ scheduleId: s.id, ok: true });
    } catch (e: any) {
      const next = computeNextRun(s, now);
      await (supabaseAdmin as any).from("backup_schedules").update({
        last_run_at: nowIso,
        next_run_at: next.toISOString(),
      }).eq("id", s.id);
      results.push({ scheduleId: s.id, ok: false, error: String(e?.message ?? e) });
    }
  }
  return { ran: results.length, results };
}
