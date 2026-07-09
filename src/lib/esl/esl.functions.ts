import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonLike = string | number | boolean | null | JsonLike[] | { [k: string]: JsonLike };

export type EslLabelRow = {
  id: string; property_id: string; template_id: string | null;
  inventory_item_id: string | null; pos_menu_item_id: string | null;
  label_code: string | null; barcode_type: string | null;
  custom_text: string | null; price_override: number | null;
  last_synced_at: string | null; sync_status: string | null;
  created_at: string; updated_at: string;
};
export type EslTemplateRow = {
  id: string; property_id: string; name: string;
  width_mm: number; height_mm: number; layout: JsonLike; active: boolean;
  created_at: string; updated_at: string;
};
export type EslBatchRow = {
  id: string; property_id: string; label_count: number; format: string;
  status: string; error: string | null; file_url: string | null;
  created_at: string; completed_at: string | null;
};

function plain<T>(rows: unknown[]): T[] { return JSON.parse(JSON.stringify(rows)) as T[]; }

export const listEslLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EslLabelRow[]> => {
    const { data, error } = await context.supabase
      .from("esl_labels").select("*").order("updated_at", { ascending: false }).limit(500);
    if (error) throw error;
    return plain<EslLabelRow>(data ?? []);
  });

export const listEslTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EslTemplateRow[]> => {
    const { data, error } = await context.supabase
      .from("esl_templates").select("*").order("name");
    if (error) throw error;
    return plain<EslTemplateRow>(data ?? []);
  });

export const upsertEslLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string; propertyId: string; templateId?: string | null;
    inventory_item_id?: string | null; pos_menu_item_id?: string | null;
    label_code?: string | null; barcode_type?: "CODE128" | "EAN13" | "UPC-A" | "QR";
    custom_text?: string | null; price_override?: number | null;
  }) => input)
  .handler(async ({ data, context }) => {
    const row = {
      property_id: data.propertyId, template_id: data.templateId ?? null,
      inventory_item_id: data.inventory_item_id ?? null,
      pos_menu_item_id: data.pos_menu_item_id ?? null,
      label_code: data.label_code ?? null,
      barcode_type: data.barcode_type ?? "CODE128",
      custom_text: data.custom_text ?? null,
      price_override: data.price_override ?? null,
      sync_status: "pending",
    };
    if (data.id) {
      const { error } = await context.supabase.from("esl_labels").update(row).eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: ins, error } = await context.supabase.from("esl_labels")
      .insert(row).select("id").single();
    if (error) throw error;
    return { id: ins.id };
  });

export const deleteEslLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("esl_labels").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const upsertEslTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string; propertyId: string; name: string;
    width_mm: number; height_mm: number; active?: boolean;
    layout?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data, context }) => {
    const row = {
      property_id: data.propertyId, name: data.name,
      width_mm: data.width_mm, height_mm: data.height_mm,
      active: data.active ?? true, layout: (data.layout ?? {}) as unknown as JsonLike,
    };
    if (data.id) {
      const { error } = await context.supabase.from("esl_templates").update(row).eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: ins, error } = await context.supabase.from("esl_templates")
      .insert(row).select("id").single();
    if (error) throw error;
    return { id: ins.id };
  });

export const createSyncBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    propertyId: string; format: "csv" | "json" | "xml";
  }) => input)
  .handler(async ({ data, context }) => {
    const { data: labels, error: le } = await context.supabase
      .from("esl_labels").select("*").eq("property_id", data.propertyId);
    if (le) throw le;

    const { data: batch, error: be } = await context.supabase.from("esl_sync_batches").insert({
      property_id: data.propertyId, created_by: context.userId,
      label_count: labels?.length ?? 0, format: data.format,
      status: "completed", completed_at: new Date().toISOString(),
    }).select("id").single();
    if (be) throw be;

    // Mark labels as synced
    await context.supabase.from("esl_labels")
      .update({ sync_status: "synced", last_synced_at: new Date().toISOString() })
      .eq("property_id", data.propertyId);

    return { id: batch.id, count: labels?.length ?? 0 };
  });

export const listSyncBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EslBatchRow[]> => {
    const { data, error } = await context.supabase
      .from("esl_sync_batches").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return plain<EslBatchRow>(data ?? []);
  });
