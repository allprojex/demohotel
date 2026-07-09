import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const logAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    propertyId: string | null;
    entityType: string; entityId?: string; action: string;
    before?: unknown; after?: unknown; memo?: string;
    ip?: string; userAgent?: string; os?: string; browser?: string;
    fingerprint?: string; sessionId?: string;
    success?: boolean; remarks?: string;
  }) => d)
  .handler(async ({ data, context }) => {
    if (data.propertyId) {
      const { data: ok, error: accErr } = await context.supabase.rpc("can_access_property", {
        _user_id: context.userId,
        _property_id: data.propertyId,
      });
      if (accErr) throw new Error(`can_access_property rpc failed: ${accErr.message}`);
      if (!ok) throw new Error("Not authorized to record audit events for this property");
    } else {
      const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "super_admin" as never,
      } as never);
      if (roleErr) throw new Error(`has_role rpc failed: ${roleErr.message}`);
      if (!isSuper) throw new Error("Only super_admin may record system-level audit events");
    }
    const { data: id, error } = await context.supabase.rpc("audit_capture", {
      _property_id: data.propertyId,
      _entity_type: data.entityType,
      _entity_id: data.entityId ?? null,
      _action: data.action,
      _before: (data.before ?? null) as never,
      _after: (data.after ?? null) as never,
      _memo: data.memo ?? null,
      _ip: data.ip ?? null,
      _user_agent: data.userAgent ?? null,
      _os: data.os ?? null,
      _browser: data.browser ?? null,
      _fingerprint: data.fingerprint ?? null,
      _session_id: data.sessionId ?? null,
      _success: data.success ?? true,
      _remarks: data.remarks ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { id };
  });

export const purgeAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId?: string | null; before?: string | null }) => d)
  .handler(async ({ data, context }): Promise<{ purged: number }> => {
    const { data: n, error } = await context.supabase.rpc("audit_purge", {
      _property_id: data.propertyId ?? null,
      _before: data.before ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { purged: (n as unknown as number) ?? 0 };
  });
