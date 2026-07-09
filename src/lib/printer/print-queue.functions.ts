import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PrintJobRow } from "@/lib/printer/printers.functions";

export type PrintJobFilters = {
  status?: string | null;
  jobType?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
};

function plain<T>(rows: unknown[]): T[] { return JSON.parse(JSON.stringify(rows)) as T[]; }

export const listPrintJobsFiltered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PrintJobFilters) => input ?? {})
  .handler(async ({ data, context }): Promise<PrintJobRow[]> => {
    let q = context.supabase
      .from("print_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 200, 1000));
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.jobType && data.jobType !== "all") q = q.eq("job_type", data.jobType);
    if (data.from) q = q.gte("created_at", new Date(data.from).toISOString());
    if (data.to) q = q.lte("created_at", new Date(data.to).toISOString());
    const { data: rows, error } = await q;
    if (error) throw error;
    return plain<PrintJobRow>(rows ?? []);
  });

export const retryPrintJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("print_jobs")
      .update({ status: "pending", error: null, started_at: null, completed_at: null })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const cancelPrintJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("print_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.id)
      .in("status", ["pending", "processing"]);
    if (error) throw error;
    return { ok: true };
  });

export const bulkPrintJobAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[]; action: "retry" | "cancel" }) => input)
  .handler(async ({ data, context }) => {
    if (!data.ids.length) return { ok: true, count: 0 };
    if (data.action === "retry") {
      const { error } = await context.supabase.from("print_jobs")
        .update({ status: "pending", error: null, started_at: null, completed_at: null })
        .in("id", data.ids);
      if (error) throw error;
    } else {
      const { error } = await context.supabase.from("print_jobs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .in("id", data.ids)
        .in("status", ["pending", "processing"]);
      if (error) throw error;
    }
    return { ok: true, count: data.ids.length };
  });
