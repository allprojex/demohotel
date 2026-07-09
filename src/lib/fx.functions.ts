import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_ONLY = ["super_admin"] as const;

/**
 * Fetches latest FX rates from exchangerate.host with the system's default currency
 * as base, and upserts every enabled currency into public.fx_rates for today.
 * Records status in public.system_settings. Super-admin only.
 */
export const refreshFxRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: rErr } = await supabase.rpc("has_any_role", {
      _user_id: userId, _roles: ADMIN_ONLY as never, _property_id: undefined,
    });
    if (rErr) throw new Error(rErr.message);
    if (!isAdmin) throw new Error("Only super_admin may refresh FX rates");

    return await runFxRefresh();
  });

/** Server-only executor callable from the cron route. */
export async function runFxRefresh(): Promise<{ ok: boolean; base: string; count: number; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: settings } = await (supabaseAdmin.from("system_settings") as any)
    .select("default_currency, fx_provider").eq("id", true).maybeSingle();
  const base = (settings as any)?.default_currency ?? "GHS";

  const { data: currencies } = await supabaseAdmin.from("currencies").select("code");
  const codes = (currencies ?? []).map((c: any) => c.code).filter((c: string) => c !== base);

  try {
    const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}&symbols=${codes.join(",")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number>; date?: string };
    const rates = body.rates ?? {};
    const asOf = body.date ?? new Date().toISOString().slice(0, 10);

    const rows = Object.entries(rates).map(([toCode, rate]) => ({
      from_code: base, to_code: toCode, rate, as_of_date: asOf,
    }));

    // Upsert (unique on from_code+to_code+as_of_date)
    if (rows.length) {
      const { error } = await (supabaseAdmin.from("fx_rates") as any)
        .upsert(rows, { onConflict: "from_code,to_code,as_of_date" });
      if (error) throw new Error(error.message);
    }

    await (supabaseAdmin.from("system_settings") as any).update({
      fx_last_synced_at: new Date().toISOString(),
      fx_last_status: "ok",
      fx_last_error: null,
    }).eq("id", true);

    return { ok: true, base, count: rows.length };
  } catch (e) {
    const msg = (e as Error).message;
    await (supabaseAdmin.from("system_settings") as any).update({
      fx_last_synced_at: new Date().toISOString(),
      fx_last_status: "failed",
      fx_last_error: msg,
    }).eq("id", true);
    return { ok: false, base, count: 0, error: msg };
  }
}

export const updateSystemSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { default_currency?: string; fx_refresh_interval_minutes?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_any_role", {
      _user_id: userId, _roles: ADMIN_ONLY as never, _property_id: undefined,
    });
    if (!isAdmin) throw new Error("Only super_admin may change system settings");

    const patch: Record<string, unknown> = {};
    if (data.default_currency) patch.default_currency = data.default_currency;
    if (data.fx_refresh_interval_minutes) patch.fx_refresh_interval_minutes = data.fx_refresh_interval_minutes;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin.from("system_settings") as any).update(patch).eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
