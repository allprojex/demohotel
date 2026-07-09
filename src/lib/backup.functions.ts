import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Universal backup & recovery.
 * - Super admin only.
 * - Exports every application table to a single JSON archive.
 * - Restores from the same archive via chunked upsert by primary key `id`.
 *
 * NOTE: This is a *logical* backup. For a full physical Postgres dump
 * (roles, sequences, extensions), use Cloud → Advanced settings → Export data.
 */

export { BACKUP_TABLES } from "./backup.tables";
import { BACKUP_TABLES as _TABLES } from "./backup.tables";

const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 100_000;

async function assertSuperAdmin(context: any) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Super admin only");
}

export type BackupArchive = {
  version: 1;
  createdAt: string;
  tables: string[];
  data: Record<string, any[]>;
  counts: Record<string, number>;
};

export const exportBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tables?: string[] }) => d ?? {})
  .handler(async ({ data, context }): Promise<BackupArchive> => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tables = (data.tables && data.tables.length ? data.tables : _TABLES).filter((t: string) =>
      _TABLES.includes(t),
    );

    const out: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const rows: any[] = [];
      let from = 0;
      // Paginate to bypass PostgREST row cap.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: chunk, error } = await (supabaseAdmin as any)
          .from(table)
          .select("*")
          .range(from, from + PAGE - 1);
        if (error) {
          // Missing table or permission — skip but record.
          counts[table] = -1;
          break;
        }
        if (!chunk || chunk.length === 0) break;
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
        if (rows.length >= MAX_ROWS_PER_TABLE) break;
      }
      if (counts[table] !== -1) {
        out[table] = rows;
        counts[table] = rows.length;
      }
    }

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      tables,
      data: out,
      counts,
    };
  });

export type RestoreResult = {
  imported: Record<string, number>;
  errors: { table: string; error: string; sample?: any }[];
};

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { archive: BackupArchive | any; mode: "upsert" | "insert"; onlyTables?: string[] }) => {
    if (!d?.archive?.data) throw new Error("Invalid archive");
    if (![1, 2].includes(d.archive.version)) throw new Error("Unsupported archive version");
    return d;
  })
  .handler(async ({ data, context }): Promise<RestoreResult> => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const filter = new Set(data.onlyTables ?? _TABLES);
    const imported: Record<string, number> = {};
    const errors: RestoreResult["errors"] = [];

    for (const table of _TABLES) {
      if (!filter.has(table)) continue;
      const rows = data.archive.data[table];
      if (!rows || rows.length === 0) continue;
      let ok = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const q =
          data.mode === "insert"
            ? (supabaseAdmin as any).from(table).insert(chunk)
            : (supabaseAdmin as any).from(table).upsert(chunk, { onConflict: "id" });
        const { error } = await q;
        if (error) {
          errors.push({ table, error: error.message, sample: chunk[0] });
        } else {
          ok += chunk.length;
        }
      }
      imported[table] = ok;
    }

    return { imported, errors };
  });

// ─────────────────────────── Schedules & Snapshots ───────────────────────────

type ScheduleInput = {
  id?: string;
  name: string;
  scope: "system" | "property";
  propertyId?: string | null;
  kind: "full" | "incremental";
  frequency: "hourly" | "daily" | "weekly" | "monthly";
  hourUtc?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  tables?: string[] | null;
  retentionCount: number;
  enabled?: boolean;
};

export const listSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { data, error } = await (context.supabase.from("backup_schedules") as any)
      .select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ScheduleInput) => {
    if (!d.name?.trim()) throw new Error("Name required");
    if (d.scope === "property" && !d.propertyId) throw new Error("Property required for property scope");
    if (d.retentionCount < 1 || d.retentionCount > 365) throw new Error("Retention must be 1–365");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { computeNextRun } = await import("./backup.server");
    const next = computeNextRun({
      frequency: data.frequency, hour_utc: data.hourUtc ?? 2,
      day_of_week: data.dayOfWeek ?? null, day_of_month: data.dayOfMonth ?? null,
    });
    const payload = {
      name: data.name.trim(),
      property_id: data.propertyId ?? null,
      scope: data.scope,
      kind: data.kind,
      frequency: data.frequency,
      hour_utc: data.hourUtc ?? 2,
      day_of_week: data.dayOfWeek ?? null,
      day_of_month: data.dayOfMonth ?? null,
      tables: data.tables ?? null,
      retention_count: data.retentionCount,
      enabled: data.enabled ?? true,
      next_run_at: next.toISOString(),
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await (context.supabase.from("backup_schedules") as any).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await (context.supabase.from("backup_schedules") as any).insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { error } = await (context.supabase.from("backup_schedules") as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runScheduleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { executeSnapshot, pruneRetention, computeNextRun } = await import("./backup.server");
    const { data: s, error } = await (context.supabase.from("backup_schedules") as any)
      .select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const snap = await executeSnapshot({
      scheduleId: s.id, triggeredBy: context.userId, scope: s.scope,
      propertyId: s.property_id, kind: s.kind, tables: s.tables,
    });
    await pruneRetention(s.id, s.retention_count);
    const next = computeNextRun(s);
    await (context.supabase.from("backup_schedules") as any).update({
      last_run_at: new Date().toISOString(),
      last_snapshot_id: snap.snapshotId,
      next_run_at: next.toISOString(),
    }).eq("id", s.id);
    return snap;
  });

export const listSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scheduleId?: string; limit?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    let q = (context.supabase.from("backup_snapshots") as any).select("*").order("created_at", { ascending: false }).limit(data.limit ?? 100);
    if (data.scheduleId) q = q.eq("schedule_id", data.scheduleId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getSnapshotDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { snapshotId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error } = await (context.supabase.from("backup_snapshots") as any)
      .select("storage_path").eq("id", data.snapshotId).single();
    if (error) throw new Error(error.message);
    if (!snap?.storage_path) throw new Error("Snapshot has no file");
    const { data: signed, error: sErr } = await supabaseAdmin.storage.from("backups").createSignedUrl(snap.storage_path, 300);
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl };
  });

export const restoreFromSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { snapshotId: string; mode: "upsert" | "insert" }) => d)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error } = await (context.supabase.from("backup_snapshots") as any)
      .select("storage_path").eq("id", data.snapshotId).single();
    if (error) throw new Error(error.message);
    const { data: file, error: dErr } = await supabaseAdmin.storage.from("backups").download(snap.storage_path);
    if (dErr) throw new Error(dErr.message);
    const text = await file.text();
    const archive = JSON.parse(text);

    const filter = new Set<string>(archive.tables ?? Object.keys(archive.data ?? {}));
    const imported: Record<string, number> = {};
    const errors: { table: string; error: string }[] = [];
    for (const table of _TABLES) {
      if (!filter.has(table)) continue;
      const rows: any[] = archive.data?.[table] ?? [];
      if (!rows.length) continue;
      let ok = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const q = data.mode === "insert"
          ? (supabaseAdmin as any).from(table).insert(chunk)
          : (supabaseAdmin as any).from(table).upsert(chunk, { onConflict: "id" });
        const { error: e } = await q;
        if (e) errors.push({ table, error: e.message });
        else ok += chunk.length;
      }
      imported[table] = ok;
    }
    return { imported, errors };
  });

