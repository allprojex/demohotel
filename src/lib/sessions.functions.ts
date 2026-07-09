import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const pingSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    sessionKey: string; propertyId: string | null;
    userAgent: string; os: string; browser: string; fingerprint: string;
  }) => {
    if (!d.sessionKey) throw new Error("sessionKey required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await (supabase.from("user_sessions") as any).upsert({
      user_id: userId,
      property_id: data.propertyId,
      session_key: data.sessionKey,
      user_agent: data.userAgent,
      os: data.os,
      browser: data.browser,
      device_fingerprint: data.fingerprint,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,session_key" });
    return { ok: true };
  });

export type OnlineUser = {
  id: string; user_id: string; session_key: string;
  started_at: string; last_seen_at: string;
  os: string | null; browser: string | null;
  full_name: string | null; email: string | null;
  status: "online" | "idle" | "offline";
};

export const listOnlineUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Admin check via RPC
    const { data: isAdmin } = await supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["super_admin", "hotel_owner", "general_manager"] as never,
      _property_id: data.propertyId,
    });
    if (!isAdmin) throw new Error("Not permitted");

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await (supabase.from("user_sessions") as any)
      .select("id,user_id,session_key,started_at,last_seen_at,os,browser,property_id")
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const { data: profiles } = await (supabase.from("profiles") as any)
      .select("id,full_name").in("id", userIds);
    const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

    const now = Date.now();
    const out: OnlineUser[] = (rows ?? []).map((r: any) => {
      const age = now - new Date(r.last_seen_at).getTime();
      const status: OnlineUser["status"] =
        age < 2 * 60_000 ? "online" : age < 10 * 60_000 ? "idle" : "offline";
      return {
        id: r.id, user_id: r.user_id, session_key: r.session_key,
        started_at: r.started_at, last_seen_at: r.last_seen_at,
        os: r.os, browser: r.browser,
        full_name: (nameMap.get(r.user_id) as string) ?? null,
        email: null,
        status,
      };
    });

    const [{ count: totalUsers }] = await Promise.all([
      (supabase.from("profiles") as any).select("id", { count: "exact", head: true }),
    ]);
    return {
      users: out,
      counts: {
        online: out.filter((u) => u.status === "online").length,
        idle: out.filter((u) => u.status === "idle").length,
        totalRegistered: totalUsers ?? 0,
        activeSessions: out.filter((u) => u.status !== "offline").length,
      },
    };
  });

export const purgeOnlineUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string; scope?: "property" | "all" }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: isAdmin } = await supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["super_admin", "hotel_owner", "general_manager"] as never,
      _property_id: data.propertyId,
    });
    if (!isAdmin) throw new Error("Not permitted");

    let q = (supabase.from("user_sessions") as any).delete();
    if ((data.scope ?? "property") === "property") {
      q = q.eq("property_id", data.propertyId);
    } else {
      // scope=all — allowed only for super_admin (verified by has_any_role above only for one property).
      // Require an explicit super_admin check.
      const { data: isSuper } = await supabase.rpc("has_any_role", {
        _user_id: context.userId,
        _roles: ["super_admin"] as never,
        _property_id: null as unknown as string,
      });
      if (!isSuper) throw new Error("Only super admins can purge all sessions.");
      q = q.not("id", "is", null);
    }
    const { data: deleted, error } = await q.select("id");
    if (error) throw new Error(error.message);
    const count = (deleted ?? []).length;

    await supabase.rpc("audit_capture", {
      _property_id: (data.scope ?? "property") === "property" ? data.propertyId : null,
      _entity_type: "user_sessions",
      _entity_id: null,
      _action: "delete",
      _before: null as never,
      _after: null as never,
      _memo: `Purged ${count} live session${count === 1 ? "" : "s"} (${data.scope ?? "property"})`,
      _ip: null, _user_agent: null, _os: null, _browser: null,
      _fingerprint: null, _session_id: null,
      _success: true, _remarks: null,
    } as never);

    return { ok: true, purged: count };
  });



