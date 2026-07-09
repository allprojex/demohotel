import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PrinterRow = {
  id: string; property_id: string; name: string; kind: string;
  model: string | null; protocol: string | null;
  is_default: boolean; printnode_id: string | null;
  status: string | null; last_seen_at: string | null;
  created_at: string;
};
export type PrintJobRow = {
  id: string; property_id: string; printer_id: string | null; created_by: string | null;
  job_type: string; title: string | null; copies: number; priority: number;
  status: string; error: string | null; created_at: string;
  started_at: string | null; completed_at: string | null;
};

function plain<T>(rows: unknown[]): T[] { return JSON.parse(JSON.stringify(rows)) as T[]; }

export const listPrinters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PrinterRow[]> => {
    const { data, error } = await context.supabase
      .from("printers").select("*").order("is_default", { ascending: false }).order("name");
    if (error) throw error;
    return plain<PrinterRow>(data ?? []);
  });

export const savePrinter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string; propertyId: string; name: string;
    kind: "webusb" | "webbluetooth" | "webserial" | "printnode" | "network";
    model?: string; protocol?: "escpos" | "zpl" | "raw" | "pdf";
    printnode_id?: string | null; is_default?: boolean;
    config?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data, context }) => {
    const row = {
      property_id: data.propertyId, name: data.name, kind: data.kind,
      model: data.model ?? null, protocol: data.protocol ?? "escpos",
      printnode_id: data.printnode_id ?? null, is_default: !!data.is_default,
      config: (data.config ?? {}) as any,
    };
    if (data.is_default) {
      await context.supabase.from("printers")
        .update({ is_default: false }).eq("property_id", data.propertyId);
    }
    if (data.id) {
      const { error } = await context.supabase.from("printers").update(row).eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase.from("printers")
      .insert(row).select("id").single();
    if (error) throw error;
    return { id: inserted.id };
  });

export const deletePrinter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("printers").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const recordPrintJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    propertyId: string; printerId?: string | null;
    jobType: "receipt" | "invoice" | "label" | "barcode" | "report" | "document" | "kot" | "bill";
    title?: string; copies?: number; status?: "pending" | "processing" | "completed" | "failed";
    error?: string | null; metadata?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data, context }) => {
    let printerId = data.printerId ?? null;
    if (!printerId) {
      // Resolve via routing rules → first active rule (by priority) whose printer isn't in error
      const { data: rules } = await context.supabase
        .from("printer_routing_rules")
        .select("printer_id, printers!inner(status)")
        .eq("property_id", data.propertyId)
        .eq("job_type", data.jobType)
        .eq("is_active", true)
        .order("priority");
      for (const r of (rules ?? []) as any[]) {
        if ((r.printers?.status ?? "offline") !== "error") { printerId = r.printer_id; break; }
      }
      if (!printerId && (rules ?? []).length > 0) printerId = (rules as any)[0].printer_id;
      if (!printerId) {
        const { data: def } = await context.supabase
          .from("printers").select("id")
          .eq("property_id", data.propertyId).eq("is_default", true)
          .limit(1).maybeSingle();
        printerId = def?.id ?? null;
      }
    }
    const row = {
      property_id: data.propertyId, printer_id: printerId,
      created_by: context.userId, job_type: data.jobType, title: data.title ?? null,
      copies: data.copies ?? 1, status: data.status ?? "completed",
      error: data.error ?? null, metadata: (data.metadata ?? {}) as any,
      completed_at: data.status === "failed" ? null : new Date().toISOString(),
    };
    const { data: inserted, error } = await context.supabase.from("print_jobs")
      .insert(row).select("id").single();
    if (error) throw error;
    return { id: inserted.id, printerId };
  });

export const listPrintJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PrintJobRow[]> => {
    const { data, error } = await context.supabase
      .from("print_jobs").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return plain<PrintJobRow>(data ?? []);
  });
