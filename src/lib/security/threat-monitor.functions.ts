// Server functions for the Security Center.
// - logFailedLogin: recorded from the /auth page after a failed sign-in.
// - checkAndLockout: reads the failed-attempt count and creates a lockout row
//   when threshold is exceeded. Also emits a security_events entry.
// - isCurrentlyLocked: idempotent lookup used by the /auth page.
// - listRecentSecurityEvents / listLockouts / listFailedLogins: admin views.
// - releaseLockout / resolveEvent: admin actions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const emailSchema = z.string().email().max(320);

async function serverPublic() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function serverAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const logFailedLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; userAgent?: string }) => ({
    email: emailSchema.parse(input.email),
    userAgent: input.userAgent?.slice(0, 500),
  }))
  .handler(async ({ data }) => {
    const admin = await serverAdmin();
    await admin.from("failed_login_attempts").insert({
      email: data.email.toLowerCase(),
      user_agent: data.userAgent,
    });
    return { ok: true };
  });

export const isCurrentlyLocked = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => ({
    email: emailSchema.parse(input.email),
  }))
  .handler(async ({ data }) => {
    const admin = await serverAdmin();
    const nowIso = new Date().toISOString();
    const { data: rows } = await admin
      .from("account_lockouts")
      .select("locked_until,reason,released_at")
      .eq("email", data.email.toLowerCase())
      .is("released_at", null)
      .gt("locked_until", nowIso)
      .order("locked_until", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    return row
      ? { locked: true, until: row.locked_until, reason: row.reason }
      : { locked: false };
  });

export const checkAndLockout = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; propertyId?: string | null }) => ({
    email: emailSchema.parse(input.email),
    propertyId: input.propertyId ?? null,
  }))
  .handler(async ({ data }) => {
    const admin = await serverAdmin();
    // Read threshold from any property-level setting, otherwise defaults
    const { data: cfg } = await admin
      .from("security_settings")
      .select("max_failed_attempts,lockout_duration_minutes")
      .maybeSingle();
    const max = cfg?.max_failed_attempts ?? 5;
    const minutes = cfg?.lockout_duration_minutes ?? 30;

    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("failed_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", data.email.toLowerCase())
      .gte("attempted_at", windowStart);

    if ((count ?? 0) < max) return { locked: false, attempts: count ?? 0 };

    const lockedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    await admin.from("account_lockouts").insert({
      email: data.email.toLowerCase(),
      reason: "brute_force",
      locked_until: lockedUntil,
    });
    await admin.from("security_events").insert({
      property_id: data.propertyId,
      event_type: "brute_force_detected",
      severity: "high",
      metadata: { email: data.email.toLowerCase(), attempts: count, window_min: 15 },
    });
    return { locked: true, until: lockedUntil, attempts: count ?? 0 };
  });

// ---- Admin views --------------------------------------------------------

export type SecurityEventRow = {
  id: string; property_id: string | null; user_id: string | null;
  event_type: string; severity: string;
  ip: string | null; user_agent: string | null;
  geo_country: string | null; geo_city: string | null;
  metadata: JsonValue; resolved_at: string | null; resolved_by: string | null;
  notes: string | null; created_at: string;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type LockoutRow = {
  id: string; user_id: string | null; email: string | null; ip: string | null;
  reason: string; locked_until: string; created_at: string;
  released_at: string | null; released_by: string | null;
};
export type FailedLoginRow = {
  id: string; email: string; ip: string | null; user_agent: string | null; attempted_at: string;
};

function toPlain<T>(rows: unknown[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

export const listRecentSecurityEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecurityEventRow[]> => {
    const { data, error } = await context.supabase
      .from("security_events").select("*")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return toPlain<SecurityEventRow>(data ?? []);
  });

export const listLockouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LockoutRow[]> => {
    const { data, error } = await context.supabase
      .from("account_lockouts").select("*")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return toPlain<LockoutRow>(data ?? []);
  });

export const listFailedLogins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FailedLoginRow[]> => {
    const { data, error } = await context.supabase
      .from("failed_login_attempts").select("*")
      .order("attempted_at", { ascending: false }).limit(200);
    if (error) throw error;
    return toPlain<FailedLoginRow>(data ?? []);
  });




export const releaseLockout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("account_lockouts")
      .update({ released_at: new Date().toISOString(), released_by: context.userId })
      .eq("id", data.id);
    if (error) throw error;
    // Wipe failed attempts for the same email
    const { data: row } = await context.supabase
      .from("account_lockouts").select("email").eq("id", data.id).maybeSingle();
    if (row?.email) {
      await context.supabase.from("failed_login_attempts").delete().eq("email", row.email);
    }
    await context.supabase.from("security_events").insert({
      event_type: "account_unlocked",
      severity: "medium",
      user_id: context.userId,
      metadata: { lockout_id: data.id, released_by: context.userId },
    });
    return { ok: true };
  });

export const resolveEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; notes?: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("security_events")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: context.userId,
        notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const getSecuritySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("security_settings")
      .select("*")
      .maybeSingle();
    return data;
  });

export const saveSecuritySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    propertyId: string;
    max_failed_attempts: number;
    lockout_duration_minutes: number;
    mfa_required: boolean;
    session_max_age_hours: number;
    allow_concurrent_sessions: boolean;
    notify_on_critical: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("security_settings")
      .upsert({
        property_id: data.propertyId,
        max_failed_attempts: data.max_failed_attempts,
        lockout_duration_minutes: data.lockout_duration_minutes,
        mfa_required: data.mfa_required,
        session_max_age_hours: data.session_max_age_hours,
        allow_concurrent_sessions: data.allow_concurrent_sessions,
        notify_on_critical: data.notify_on_critical,
      }, { onConflict: "property_id" });
    if (error) throw error;
    return { ok: true };
  });
