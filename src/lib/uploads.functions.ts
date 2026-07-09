import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_ROLES = ["super_admin", "hotel_owner", "general_manager"] as const;

async function assertAdmin(context: any, propertyId: string) {
  const { data: ok, error } = await context.supabase.rpc("has_any_role", {
    _user_id: context.userId,
    _roles: ADMIN_ROLES as never,
    _property_id: propertyId,
  });
  if (error) throw new Error(error.message);
  if (!ok) throw new Error("Admins only");
}

export type UploadTargetKind = "menu" | "product" | "inventory" | "service" | "price_list";

export const createUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    propertyId: string; targetKind: UploadTargetKind;
    filename: string; storagePath?: string;
    rows: Record<string, unknown>[];
  }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    if (!Array.isArray(d.rows) || d.rows.length === 0) throw new Error("rows required");
    if (d.rows.length > 5000) throw new Error("Max 5000 rows per upload");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.propertyId);
    const { supabase } = context;

    // Duplicate detection summary (very simple: repeated 'name' or 'code' fields)
    const seen = new Map<string, number>();
    const duplicates: number[] = [];
    data.rows.forEach((r, i) => {
      const k = String(r.code ?? r.name ?? r.sku ?? "").trim().toLowerCase();
      if (!k) return;
      if (seen.has(k)) duplicates.push(i); else seen.set(k, i);
    });

    const { data: upload, error: upErr } = await (supabase.from("data_uploads") as any).insert({
      property_id: data.propertyId,
      uploaded_by: context.userId,
      target_kind: data.targetKind,
      filename: data.filename,
      storage_path: data.storagePath ?? null,
      row_count: data.rows.length,
      status: "pending",
      summary: { duplicates: duplicates.length, distinctKeys: seen.size },
      errors: duplicates.length ? [{ code: "duplicate_rows", rows: duplicates }] : [],
    }).select("id").single();
    if (upErr) throw new Error(upErr.message);

    const rows = data.rows.map((payload, i) => ({
      upload_id: upload.id, row_index: i, payload, status: duplicates.includes(i) ? "duplicate" : "pending",
    }));
    // Chunk insert
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await (supabase.from("data_upload_rows") as any).insert(chunk);
      if (error) throw new Error(error.message);
    }

    await context.supabase.rpc("audit_capture", {
      _property_id: data.propertyId, _entity_type: "data_upload", _entity_id: upload.id,
      _action: "import", _before: null as never, _after: { rows: data.rows.length } as never,
      _memo: `Uploaded ${data.filename}`,
      _ip: null, _user_agent: null, _os: null, _browser: null,
      _fingerprint: null, _session_id: null, _success: true, _remarks: null,
    } as never);

    return { uploadId: upload.id, duplicates: duplicates.length };
  });

export const approveUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { uploadId: string; propertyId: string }) => {
    if (!d.uploadId || !d.propertyId) throw new Error("uploadId, propertyId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.propertyId);
    const { supabase } = context;
    const { data: up, error: upErr } = await (supabase.from("data_uploads") as any)
      .select("*").eq("id", data.uploadId).single();
    if (upErr) throw new Error(upErr.message);
    if (up.status !== "pending") throw new Error(`Upload is ${up.status}`);

    const { data: rows } = await (supabase.from("data_upload_rows") as any)
      .select("row_index,payload,status").eq("upload_id", data.uploadId).order("row_index");

    let imported = 0;
    const errors: any[] = [];

    if (up.target_kind === "menu") {
      // Pick first outlet for the property (or expect payload.outlet)
      const { data: outlets } = await (supabase.from("pos_outlets") as any)
        .select("id,name").eq("property_id", data.propertyId);
      const outletByName = new Map<string, string>();
      (outlets ?? []).forEach((o: any) => outletByName.set(String(o.name).toLowerCase(), o.id));
      const defaultOutlet: string | null = outlets?.[0]?.id ?? null;

      const catCache = new Map<string, string>();
      async function ensureCategory(outletId: string, name: string): Promise<string | null> {
        const key = `${outletId}::${name.toLowerCase()}`;
        if (catCache.has(key)) return catCache.get(key)!;
        const { data: existing } = await (supabase.from("pos_menu_categories") as any)
          .select("id").eq("outlet_id", outletId).ilike("name", name).maybeSingle();
        if (existing) { catCache.set(key, existing.id); return existing.id; }
        const { data: created, error } = await (supabase.from("pos_menu_categories") as any)
          .insert({ property_id: data.propertyId, outlet_id: outletId, name }).select("id").single();
        if (error) return null;
        catCache.set(key, created.id); return created.id;
      }

      for (const r of rows ?? []) {
        const p = r.payload as any;
        if (r.status === "duplicate") continue;
        const outletId = outletByName.get(String(p.outlet ?? "").toLowerCase()) ?? defaultOutlet;
        if (!outletId) { errors.push({ row: r.row_index, error: "No POS outlet exists" }); continue; }
        const catName = String(p.category ?? "").trim();
        const catId = catName ? await ensureCategory(outletId, catName) : null;
        const { error } = await (supabase.from("pos_menu_items") as any).insert({
          property_id: data.propertyId,
          outlet_id: outletId,
          category_id: catId,
          name: String(p.name ?? "").trim(),
          price: Number(p.price ?? 0),
          description: p.description ? String(p.description) : null,
        });
        if (error) errors.push({ row: r.row_index, error: error.message });
        else imported++;
      }
    } else if (up.target_kind === "inventory" || up.target_kind === "product") {
      for (const r of rows ?? []) {
        const p = r.payload as any;
        if (r.status === "duplicate") continue;
        const { error } = await (supabase.from("inventory_items") as any).insert({
          property_id: data.propertyId,
          name: String(p.name ?? "").trim(),
          sku: String(p.sku ?? p.name ?? "").trim(),
          unit: p.unit ? String(p.unit) : "each",
          cost: p.cost ? Number(p.cost) : 0,
          sale_price: p.price ? Number(p.price) : 0,
        });
        if (error) errors.push({ row: r.row_index, error: error.message });
        else imported++;
      }
    } else {
      // service / price_list — record as approved-only (implementers wire specific tables later).
    }

    await (supabase.from("data_uploads") as any).update({
      status: errors.length && !imported ? "rejected" : "imported",
      approved_by: context.userId,
      approved_at: new Date().toISOString(),
      summary: { ...up.summary, imported, errors: errors.length },
      errors: [...(up.errors ?? []), ...errors],
    }).eq("id", data.uploadId);

    await context.supabase.rpc("audit_capture", {
      _property_id: data.propertyId, _entity_type: "data_upload", _entity_id: data.uploadId,
      _action: "approve", _before: null as never, _after: { imported, errors: errors.length } as never,
      _memo: `Approved ${up.filename}`,
      _ip: null, _user_agent: null, _os: null, _browser: null,
      _fingerprint: null, _session_id: null, _success: errors.length === 0, _remarks: null,
    } as never);

    return { imported, errors: errors.length };
  });

export const rejectUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { uploadId: string; propertyId: string; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.propertyId);
    const { error } = await (context.supabase.from("data_uploads") as any).update({
      status: "rejected", approved_by: context.userId, approved_at: new Date().toISOString(),
      summary: { rejectedReason: data.reason ?? "" },
    }).eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { uploadId: string; propertyId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.propertyId);
    const { error } = await (context.supabase.from("data_uploads") as any).delete().eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
