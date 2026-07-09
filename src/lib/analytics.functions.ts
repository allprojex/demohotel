import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RangeSchema = z.object({
  propertyId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getExecKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("exec_analytics_kpis", {
      _property_id: data.propertyId, _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return rows?.[0] ?? null;
  });

export const getExecRevenueByDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("exec_analytics_revenue_by_day", {
      _property_id: data.propertyId, _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getExecRevenueBySource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("exec_analytics_revenue_by_source", {
      _property_id: data.propertyId, _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getExecTopRoomTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("exec_analytics_top_room_types", {
      _property_id: data.propertyId, _from: data.from, _to: data.to,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
