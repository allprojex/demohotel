import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RoutingRule = {
  id: string;
  property_id: string;
  job_type: string;
  printer_id: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function plain<T>(rows: unknown[]): T[] { return JSON.parse(JSON.stringify(rows)) as T[]; }

export const listRoutingRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId: string }) => input)
  .handler(async ({ data, context }): Promise<RoutingRule[]> => {
    const { data: rows, error } = await context.supabase
      .from("printer_routing_rules")
      .select("*")
      .eq("property_id", data.propertyId)
      .order("job_type")
      .order("priority");
    if (error) throw error;
    return plain<RoutingRule>(rows ?? []);
  });

export const saveRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string;
    propertyId: string;
    jobType: string;
    printerId: string;
    priority?: number;
    isActive?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const row = {
      property_id: data.propertyId,
      job_type: data.jobType,
      printer_id: data.printerId,
      priority: data.priority ?? 0,
      is_active: data.isActive ?? true,
    };
    if (data.id) {
      const { error } = await context.supabase.from("printer_routing_rules")
        .update(row).eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase.from("printer_routing_rules")
      .insert(row).select("id").single();
    if (error) throw error;
    return { id: inserted.id };
  });

export const deleteRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("printer_routing_rules")
      .delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const toggleRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; isActive: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("printer_routing_rules")
      .update({ is_active: data.isActive }).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Resolve the best printer for a given job type on a property.
 * Rules ordered by priority (lower = first). Falls back to property default.
 */
export const resolvePrinterForJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId: string; jobType: string }) => input)
  .handler(async ({ data, context }): Promise<{ printerId: string | null }> => {
    const { data: rules } = await context.supabase
      .from("printer_routing_rules")
      .select("printer_id, priority, printers!inner(status)")
      .eq("property_id", data.propertyId)
      .eq("job_type", data.jobType)
      .eq("is_active", true)
      .order("priority");

    for (const r of (rules ?? []) as any[]) {
      if ((r.printers?.status ?? "offline") !== "error") return { printerId: r.printer_id };
    }
    if ((rules ?? []).length > 0) return { printerId: (rules as any)[0].printer_id };

    const { data: def } = await context.supabase
      .from("printers").select("id")
      .eq("property_id", data.propertyId).eq("is_default", true).limit(1).maybeSingle();
    return { printerId: def?.id ?? null };
  });

export type RoutingPreviewRow = {
  job_type: string;
  selected_printer_id: string | null;
  selected_printer_name: string | null;
  selected_printer_kind: string | null;
  selected_printer_status: string | null;
  reason: "rule" | "rule-fallback-error" | "default" | "none";
  candidates: Array<{
    printer_id: string;
    printer_name: string | null;
    kind: string | null;
    status: string | null;
    priority: number;
    skipped: boolean;
    skip_reason?: string;
  }>;
};

export const previewRoutingForProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId: string; jobTypes: string[] }) => input)
  .handler(async ({ data, context }): Promise<RoutingPreviewRow[]> => {
    const { data: rules } = await context.supabase
      .from("printer_routing_rules")
      .select("job_type, printer_id, priority, is_active, printers!inner(id,name,kind,status)")
      .eq("property_id", data.propertyId)
      .eq("is_active", true)
      .order("priority");

    const { data: def } = await context.supabase
      .from("printers").select("id,name,kind,status")
      .eq("property_id", data.propertyId).eq("is_default", true).limit(1).maybeSingle();

    const byJob = new Map<string, any[]>();
    for (const r of (rules ?? []) as any[]) {
      const arr = byJob.get(r.job_type) ?? [];
      arr.push(r);
      byJob.set(r.job_type, arr);
    }

    return data.jobTypes.map<RoutingPreviewRow>((jt) => {
      const rows = byJob.get(jt) ?? [];
      const candidates = rows.map((r) => ({
        printer_id: r.printer_id,
        printer_name: r.printers?.name ?? null,
        kind: r.printers?.kind ?? null,
        status: r.printers?.status ?? null,
        priority: r.priority,
        skipped: (r.printers?.status ?? "offline") === "error",
        skip_reason: (r.printers?.status ?? "offline") === "error" ? "printer in error state" : undefined,
      }));
      const firstOk = candidates.find((c) => !c.skipped);
      if (firstOk) {
        return {
          job_type: jt,
          selected_printer_id: firstOk.printer_id,
          selected_printer_name: firstOk.printer_name,
          selected_printer_kind: firstOk.kind,
          selected_printer_status: firstOk.status,
          reason: "rule",
          candidates,
        };
      }
      if (candidates.length > 0) {
        const c = candidates[0];
        return {
          job_type: jt,
          selected_printer_id: c.printer_id,
          selected_printer_name: c.printer_name,
          selected_printer_kind: c.kind,
          selected_printer_status: c.status,
          reason: "rule-fallback-error",
          candidates,
        };
      }
      if (def) {
        return {
          job_type: jt,
          selected_printer_id: def.id,
          selected_printer_name: def.name,
          selected_printer_kind: def.kind,
          selected_printer_status: def.status,
          reason: "default",
          candidates: [],
        };
      }
      return {
        job_type: jt,
        selected_printer_id: null,
        selected_printer_name: null,
        selected_printer_kind: null,
        selected_printer_status: null,
        reason: "none",
        candidates: [],
      };
    });
  });

