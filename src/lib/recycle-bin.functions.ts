import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonLike = string | number | boolean | null | JsonLike[] | { [k: string]: JsonLike };

export type RecycleBinRow = {
  id: string;
  property_id: string | null;
  source_table: string;
  source_id: string;
  label: string | null;
  snapshot: JsonLike;
  deleted_by: string | null;
  deleted_at: string;
  restored_at: string | null;
  purged_at: string | null;
};

function plain<T>(rows: unknown[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

async function audit(
  supabase: any,
  propertyId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  memo: string,
  before: unknown = null,
  after: unknown = null,
) {
  await supabase.rpc("audit_capture", {
    _property_id: propertyId,
    _entity_type: entityType,
    _entity_id: entityId,
    _action: action,
    _before: before as never,
    _after: after as never,
    _memo: memo,
    _ip: null, _user_agent: null, _os: null, _browser: null,
    _fingerprint: null, _session_id: null,
    _success: true, _remarks: null,
  });
}

export const listRecycleBin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId?: string | null; sourceTable?: string | null; includePurged?: boolean }) => input)
  .handler(async ({ data, context }): Promise<RecycleBinRow[]> => {
    let q = (context.supabase.from("recycle_bin") as any)
      .select("*")
      .order("deleted_at", { ascending: false })
      .limit(500);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    if (data.sourceTable) q = q.eq("source_table", data.sourceTable);
    if (!data.includePurged) q = q.is("purged_at", null).is("restored_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return plain<RecycleBinRow>(rows ?? []);
  });

export const restoreRecycleBinItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase.from("recycle_bin") as any)
      .select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (row.restored_at || row.purged_at) throw new Error("Item is no longer restorable.");

    const { error: insErr } = await (context.supabase.from(row.source_table) as any)
      .upsert(row.snapshot, { onConflict: "id" });
    if (insErr) throw new Error(`Restore failed: ${insErr.message}`);

    const { error: upErr } = await (context.supabase.from("recycle_bin") as any)
      .update({ restored_at: new Date().toISOString() }).eq("id", data.id);
    if (upErr) throw new Error(upErr.message);

    await audit(
      context.supabase, row.property_id, row.source_table, row.source_id,
      "update", `Restored from recycle bin (${row.source_table})`,
      null, row.snapshot,
    );
    await audit(
      context.supabase, row.property_id, "recycle_bin", row.id,
      "update", "Recycle bin entry restored",
    );
    return { ok: true };
  });

export const purgeRecycleBinItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase.from("recycle_bin") as any)
      .select("*").eq("id", data.id).maybeSingle();
    const { error } = await (context.supabase.from("recycle_bin") as any)
      .update({ purged_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);

    await audit(
      context.supabase, row?.property_id ?? null, "recycle_bin", data.id,
      "delete", `Permanently purged ${row?.source_table ?? "item"}`,
      row?.snapshot, null,
    );
    return { ok: true };
  });

export const emptyRecycleBin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    let q = (context.supabase.from("recycle_bin") as any)
      .update({ purged_at: new Date().toISOString() })
      .is("purged_at", null).is("restored_at", null);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    const { data: updated, error } = await q.select("id");
    if (error) throw new Error(error.message);

    await audit(
      context.supabase, data.propertyId ?? null, "recycle_bin", null,
      "delete",
      `Emptied recycle bin (${(updated ?? []).length} item${(updated ?? []).length === 1 ? "" : "s"})`,
    );
    return { ok: true, purged: (updated ?? []).length };
  });

export const moveToRecycleBin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    sourceTable: string;
    sourceId: string;
    snapshot: Record<string, unknown>;
    propertyId?: string | null;
    label?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("recycle_bin") as any).insert({
      source_table: data.sourceTable,
      source_id: data.sourceId,
      snapshot: data.snapshot,
      property_id: data.propertyId ?? null,
      label: data.label ?? null,
      deleted_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
