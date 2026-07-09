import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runServerOp } from "@/lib/server/errors.server";

const ADMIN_ROLES = ["super_admin", "hotel_owner", "general_manager"] as const;
// Roles that only super_admin or hotel_owner may grant.
const ELEVATED_ROLES = new Set(["super_admin", "hotel_owner", "general_manager"]);

async function assertAdmin(context: any, propertyId: string | null | undefined) {
  const { supabase, userId } = context;
  const { data: isAdmin, error } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ADMIN_ROLES as never,
    _property_id: propertyId || undefined,
  });
  if (error) throw new Error(`has_any_role rpc failed: ${error.message}`);
  if (!isAdmin) {
    throw new Error(
      `Not authorized: caller lacks ${ADMIN_ROLES.join("/")} on property ${propertyId ?? "(none)"}`,
    );
  }
}

/** Enforce that the caller may grant `role` on `propertyId`.
 *  - super_admin can grant anything.
 *  - hotel_owner (on this property) can grant any non-super_admin role.
 *  - Other admins (general_manager) can grant only non-elevated roles
 *    (front_desk, cashier, housekeeping, etc.) and only on their property. */
async function assertCanGrantRole(context: any, role: string, propertyId: string) {
  const { supabase, userId } = context;
  const { data: rows, error } = await supabase
    .from("user_roles").select("role,property_id").eq("user_id", userId);
  if (error) throw new Error(`role lookup failed: ${error.message}`);
  const held = (rows ?? []) as { role: string; property_id: string | null }[];
  const isSuper = held.some((r) => r.role === "super_admin");
  if (isSuper) return;
  if (role === "super_admin") throw new Error("Only super_admin may grant super_admin");
  const isOwnerHere = held.some((r) => r.role === "hotel_owner" && (r.property_id === null || r.property_id === propertyId));
  if (ELEVATED_ROLES.has(role) && !isOwnerHere) {
    throw new Error(`Only super_admin or hotel_owner may grant '${role}'`);
  }
  // Non-elevated: any admin scoped to this property is fine (assertAdmin already checked).
}


export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { email: string; fullName: string; role?: string; roles?: string[]; propertyId: string }) => {
    if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new Error("Valid email required");
    if (!d.fullName?.trim()) throw new Error("Full name required");
    const rolesList = (d.roles && d.roles.length > 0) ? d.roles : (d.role ? [d.role] : []);
    if (rolesList.length === 0) throw new Error("At least one role required");
    const needsProp = rolesList.some((r) => r !== "super_admin");
    if (!d.propertyId && needsProp) throw new Error("Property required");
    return { ...d, roles: rolesList };
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.inviteUser", email: data.email, roles: data.roles, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        // Scope check: caller must be permitted to grant every requested role.
        for (const r of data.roles) await assertCanGrantRole(context, r, data.propertyId);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const siteUrl = process.env.SITE_URL || "";
        const { data: invited, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          data.email,
          {
            data: { full_name: data.fullName },
            redirectTo: siteUrl ? `${siteUrl}/reset-password` : undefined,
          },
        );

        let targetId: string | null = invited?.user?.id ?? null;

        if (invErr) {
          const msg = invErr.message?.toLowerCase() ?? "";
          if (!msg.includes("registered") && !msg.includes("exists")) throw invErr;
          const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
          if (listErr) throw listErr;
          const found = list.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
          if (!found) throw new Error(`User ${data.email} exists in Auth but could not be located via listUsers`);
          targetId = found.id;
        }

        if (!targetId) throw new Error("Invite did not return a target user id");

        // Insert via caller's supabase so enforce_user_role_scope trigger sees auth.uid()
        for (const role of data.roles) {
          const { error: grantErr } = await context.supabase.from("user_roles").insert({
            user_id: targetId,
            role: role as never,
            property_id: role === "super_admin" ? null : data.propertyId,
          });
          if (grantErr && !grantErr.message.toLowerCase().includes("duplicate")) throw grantErr;
        }

        await (supabaseAdmin.from("profiles") as any)
          .upsert({ id: targetId, full_name: data.fullName, status: "pending" }, { onConflict: "id" });

        return { userId: targetId, invited: !invErr, roles: data.roles };
      },
    ),
  );


export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; status: "pending" | "active" | "disabled"; propertyId: string }) => {
    if (!d.userId) throw new Error("userId required");
    if (!d.propertyId) throw new Error("propertyId required");
    if (!["pending", "active", "disabled"].includes(d.status)) throw new Error("Invalid status");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.setUserStatus", userId: data.userId, status: data.status, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const banDuration = data.status === "disabled" ? "876000h" : "none";
        const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          ban_duration: banDuration,
        } as any);
        if (banErr) throw banErr;

        const patch: Record<string, unknown> = { status: data.status };
        if (data.status === "active") {
          patch.approved_at = new Date().toISOString();
          patch.approved_by = context.userId;
        }
        const { error } = await (supabaseAdmin.from("profiles") as any)
          .update(patch).eq("id", data.userId);
        if (error) throw error;

        return { ok: true, status: data.status };
      },
    ),
  );

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; email: string; propertyId: string }) => {
    if (!d.userId || !d.email || !d.propertyId) throw new Error("userId, email, propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.resetUserPassword", userId: data.userId, email: data.email, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const siteUrl = process.env.SITE_URL || "";
        const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: data.email,
          options: { redirectTo: siteUrl ? `${siteUrl}/reset-password` : undefined },
        });
        if (error) throw error;
        return { ok: true, actionLink: link?.properties?.action_link ?? null };
      },
    ),
  );

export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; fullName?: string; phone?: string; propertyId: string }) => {
    if (!d.userId || !d.propertyId) throw new Error("userId, propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.updateUserProfile", userId: data.userId, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: Record<string, unknown> = {};
        if (data.fullName !== undefined) patch.full_name = data.fullName;
        if (data.phone !== undefined) patch.phone = data.phone;
        const { error } = await (supabaseAdmin.from("profiles") as any).update(patch).eq("id", data.userId);
        if (error) throw error;
        return { ok: true };
      },
    ),
  );

export type ManageableUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  status: "pending" | "active" | "disabled";
  created_at: string;
  approved_at: string | null;
  banned_until: string | null;
  roles: { id: string; role: string; property_id: string | null }[];
};

export const listManageableUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { propertyId: string }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }): Promise<ManageableUser[]> =>
    runServerOp(
      { op: "users.listManageableUsers", propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Only users who actually hold a role at this property (or global roles).
        const roleRes = await (supabaseAdmin.from("user_roles") as any)
          .select("id,user_id,role,property_id")
          .or(`property_id.eq.${data.propertyId},property_id.is.null`);
        if (roleRes.error) throw roleRes.error;
        const roles = roleRes.data ?? [];
        const scopedIds = Array.from(new Set((roles as any[]).map((r) => r.user_id))).filter(Boolean);
        if (scopedIds.length === 0) return [];

        // 2. Fetch profiles + auth data ONLY for those scoped users.
        const [profRes, authRes] = await Promise.all([
          (supabaseAdmin.from("profiles") as any)
            .select("id,full_name,phone,status,created_at,approved_at")
            .in("id", scopedIds),
          Promise.all(
            scopedIds.map((id) =>
              supabaseAdmin.auth.admin.getUserById(id).then(
                (r) => (r.error ? null : r.data.user),
                () => null,
              ),
            ),
          ),
        ]);
        if (profRes.error) throw profRes.error;

        const profiles = profRes.data ?? [];
        const authUsers = (authRes ?? []).filter(Boolean) as any[];

        const rolesByUser = new Map<string, any[]>();
        (roles as any[]).forEach((r) => {
          const arr = rolesByUser.get(r.user_id) ?? [];
          arr.push({ id: r.id, role: r.role, property_id: r.property_id });
          rolesByUser.set(r.user_id, arr);
        });

        const authByUser = new Map<string, any>();
        authUsers.forEach((u) => authByUser.set(u.id, u));

        const out: ManageableUser[] = [];
        for (const id of scopedIds) {
          const p = (profiles as any[]).find((x) => x.id === id);
          const a = authByUser.get(id);
          out.push({
            id,
            email: a?.email ?? null,
            full_name: p?.full_name ?? null,
            phone: p?.phone ?? null,
            status: (p?.status ?? "pending") as any,
            created_at: p?.created_at ?? a?.created_at ?? new Date().toISOString(),
            approved_at: p?.approved_at ?? null,
            banned_until: a?.banned_until ?? null,
            roles: rolesByUser.get(id) ?? [],
          });
        }
        return out.sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
      },
    ),
  );

export const grantUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; role: string; propertyId: string }) => {
    if (!d.userId || !d.role || !d.propertyId) throw new Error("userId, role, propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.grantUserRole", userId: data.userId, role: data.role, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        await assertCanGrantRole(context, data.role, data.propertyId);
        const { error } = await context.supabase.from("user_roles").insert({
          user_id: data.userId,
          role: data.role as never,
          property_id: data.role === "super_admin" ? null : data.propertyId,
        });
        if (error && !error.message.toLowerCase().includes("duplicate")) throw error;
        return { ok: true };
      },
    ),
  );

export const revokeUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { roleId: string; propertyId: string }) => {
    if (!d.roleId || !d.propertyId) throw new Error("roleId, propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp(
      { op: "users.revokeUserRole", roleId: data.roleId, propertyId: data.propertyId },
      async () => {
        await assertAdmin(context, data.propertyId);
        const { error } = await context.supabase.from("user_roles").delete().eq("id", data.roleId);
        if (error) throw error;
        return { ok: true };
      },
    ),
  );
