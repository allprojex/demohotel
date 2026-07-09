import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!d.id) throw new Error("id required"); return d; })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("notifications") as any)
      .update({ read_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase.from("notifications") as any)
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null).eq("user_id", context.userId);
    // broadcast rows (user_id null) also mark for this user via a per-user table? For simplicity we mark own only.
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markNotificationUnread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!d.id) throw new Error("id required"); return d; })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("notifications") as any)
      .update({ read_at: null }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
