/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import {
  requireSupabaseAuth,
  requireSupabaseAuthAllowPasswordChange,
} from "@/integrations/supabase/auth-middleware";
import {
  isEmailAddress,
  normalizeIdentifier,
  validateLoginCredential,
  validatePassword,
  type LoginAccountType,
} from "@/lib/auth-identity";

const INVALID = "Invalid ID or password";

function ipHash() {
  const request = getRequest();
  const ip =
    request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request?.headers.get("x-real-ip") ||
    "unknown";
  // Deliberately non-reversible enough for rate-limit correlation; no raw IP is stored.
  let h = 2166136261;
  for (let i = 0; i < ip.length; i++) h = Math.imul(h ^ ip.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export const identifierSignIn = createServerFn({ method: "POST" })
  .validator((d: { accountType: LoginAccountType; identifier: string; password: string }) => {
    if (d.accountType !== "staff" && d.accountType !== "admin") throw new Error(INVALID);
    return {
      accountType: d.accountType,
      identifier: validateLoginCredential(d.identifier, d.accountType),
      password: d.password,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalized = normalizeIdentifier(data.identifier);
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const attempts = await ((supabaseAdmin as any).from("login_attempts") as any)
      .select("id", { count: "exact", head: true })
      .eq("identifier_normalized", normalized)
      .eq("account_type", data.accountType)
      .eq("succeeded", false)
      .gte("created_at", since);
    if ((attempts.count ?? 0) >= 5) throw new Error(INVALID);

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Authentication is unavailable");
    const auth = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const emailLogin = isEmailAddress(data.identifier);
    let succeeded = false;
    try {
      let profile: any;
      let signed: Awaited<ReturnType<typeof auth.auth.signInWithPassword>>;

      if (emailLogin) {
        signed = await auth.auth.signInWithPassword({
          email: data.identifier,
          password: data.password,
        });
        if (signed.error || !signed.data.session || !signed.data.user) throw new Error(INVALID);
        const profileRes = await (supabaseAdmin.from("profiles") as any)
          .select("id,account_type,status,must_change_password")
          .eq("id", signed.data.user.id)
          .maybeSingle();
        profile = profileRes.data;
      } else {
        const profileRes = await (supabaseAdmin.from("profiles") as any)
          .select("id,account_type,status,must_change_password")
          .eq("identifier_normalized", normalized)
          .maybeSingle();
        profile = profileRes.data;
        if (!profile || profile.account_type !== data.accountType || profile.status !== "active")
          throw new Error(INVALID);
        const authUser = await supabaseAdmin.auth.admin.getUserById(profile.id);
        const email = authUser.data.user?.email;
        if (!email) throw new Error(INVALID);
        signed = await auth.auth.signInWithPassword({ email, password: data.password });
        if (signed.error || !signed.data.session) throw new Error(INVALID);
      }

      if (!profile || profile.account_type !== data.accountType || profile.status !== "active")
        throw new Error(INVALID);
      succeeded = true;
      const now = new Date().toISOString();
      await Promise.all([
        (supabaseAdmin.from("profiles") as any)
          .update({ last_successful_login_at: now })
          .eq("id", profile.id),
        (supabaseAdmin.from("audit_logs") as any).insert({
          user_id: profile.id,
          action: "auth.login.success",
          entity: "profiles",
          entity_id: profile.id,
          meta: { account_type: data.accountType },
        }),
      ]);
      return {
        accessToken: signed.data.session.access_token,
        refreshToken: signed.data.session.refresh_token,
        mustChangePassword: !!profile.must_change_password,
        accountType: profile.account_type as LoginAccountType,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "Authentication is unavailable") throw error;
      throw new Error(INVALID);
    } finally {
      await ((supabaseAdmin as any).from("login_attempts") as any).insert({
        identifier_normalized: normalized,
        account_type: data.accountType,
        succeeded,
        ip_hash: ipHash(),
      });
      if (!succeeded && (attempts.count ?? 0) === 4) {
        await (supabaseAdmin.from("audit_logs") as any).insert({
          action: "auth.login.failure_threshold",
          entity: "profiles",
          meta: { account_type: data.accountType, identifier_normalized: normalized },
        });
      }
    }
  });

export const createDemoWorkspace = createServerFn({ method: "POST" })
  .validator((d: {
    hotelName: string;
    fullName: string;
    email: string;
    password: string;
    primaryColor?: string;
    acceptedTerms: boolean;
  }) => {
    const hotelName = d.hotelName.trim();
    const fullName = d.fullName.trim();
    const email = d.email.trim().toLowerCase();
    if (hotelName.length < 2 || hotelName.length > 100) throw new Error("Enter a valid hotel name.");
    if (fullName.length < 2 || fullName.length > 100) throw new Error("Enter your full name.");
    if (!isEmailAddress(email)) throw new Error("Enter a valid email address.");
    validatePassword(d.password);
    if (!d.acceptedTerms) throw new Error("Accept the demo terms to continue.");
    const primaryColor = d.primaryColor?.trim() || "#0f766e";
    if (!/^#[0-9a-f]{6}$/i.test(primaryColor)) throw new Error("Choose a valid brand colour.");
    return { hotelName, fullName, email, password: d.password, primaryColor };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const identifier = `ADMIN-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, identifier, account_type: "admin" },
    });
    if (created.error || !created.data.user) {
      if (created.error?.message.toLowerCase().includes("registered")) throw new Error("An account already exists for this email.");
      throw created.error ?? new Error("Could not create the demo account.");
    }
    const userId = created.data.user.id;
    try {
      const slugBase = data.hotelName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "hotel";
      const code = `DEMO-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const expires = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString();
      const property = await (supabaseAdmin.from("properties") as any).insert({
        name: data.hotelName,
        code,
        slug: `${slugBase}-${code.slice(-6).toLowerCase()}`,
        currency: "GHS",
        base_currency: "GHS",
        timezone: "Africa/Accra",
        active: true,
        is_public: false,
        is_demo: true,
        demo_expires_at: expires,
        demo_created_by: userId,
        demo_terms_accepted_at: new Date().toISOString(),
        brand_name: data.hotelName,
        brand_primary_color: data.primaryColor,
      }).select("id").single();
      if (property.error || !property.data) throw property.error ?? new Error("Could not create the hotel workspace.");
      const propertyId = property.data.id as string;
      const [role, profile] = await Promise.all([
        (supabaseAdmin.from("user_roles") as any).insert({ user_id: userId, role: "hotel_owner", property_id: propertyId }),
        (supabaseAdmin.from("profiles") as any).update({ default_property_id: propertyId, account_type: "admin", status: "active" }).eq("id", userId),
      ]);
      if (role.error) throw role.error;
      if (profile.error) throw profile.error;
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("Authentication is unavailable");
      const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await auth.auth.signInWithPassword({ email: data.email, password: data.password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("Sign in failed.");
      return { accessToken: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token, propertyId, expires };
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw error;
    }
  });

export const getPasswordChangeState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuthAllowPasswordChange])
  .handler(async ({ context }) => {
    const { data } = await (context.supabase.from("profiles") as any)
      .select("must_change_password,account_type,status,identifier,full_name")
      .eq("id", context.userId)
      .single();
    return data;
  });

export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuthAllowPasswordChange])
  .validator((d: { password: string; confirmation: string }) => {
    validatePassword(d.password);
    if (d.password !== d.confirmation) throw new Error("Passwords do not match.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const updated = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (updated.error) throw updated.error;
    const now = new Date().toISOString();
    const profile = await (supabaseAdmin.from("profiles") as any)
      .update({ must_change_password: false, password_changed_at: now })
      .eq("id", context.userId);
    if (profile.error) throw profile.error;
    await (supabaseAdmin.from("audit_logs") as any).insert({
      user_id: context.userId,
      action: "auth.password.changed",
      entity: "profiles",
      entity_id: context.userId,
    });

    // Updating a password through the Admin API invalidates refresh tokens. Issue a
    // new normal Supabase session so the mandatory-change flow can continue safely.
    const email = updated.data.user.email;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!email || !url || !key) throw new Error("Password changed. Please sign in again.");
    const auth = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await auth.auth.signInWithPassword({ email, password: data.password });
    if (signed.error || !signed.data.session) {
      throw new Error("Password changed. Please sign in again.");
    }
    return {
      ok: true,
      accessToken: signed.data.session.access_token,
      refreshToken: signed.data.session.refresh_token,
    };
  });
