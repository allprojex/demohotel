import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export function useCurrentUserId(): string | null {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => mounted && setUid(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id ?? null));
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);
  return uid;
}

/** Fetches the current user's role rows (global + property-scoped). */
export function useUserRoles() {
  const uid = useCurrentUserId();
  return useQuery({
    queryKey: ["user-roles", uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, property_id")
        .eq("user_id", uid!);
      if (error) throw error;
      return (data ?? []) as { role: AppRole; property_id: string | null }[];
    },
  });
}

/** True if the current user holds any of `roles`, either globally (super_admin / null scope)
 *  or scoped to `propertyId`. */
export function useHasAnyRole(roles: AppRole[], propertyId: string | null): {
  allowed: boolean; loading: boolean;
} {
  const q = useUserRoles();
  if (q.isLoading) return { allowed: false, loading: true };
  const rows = q.data ?? [];
  const allowed = rows.some((r) =>
    r.role === "super_admin" ||
    (roles.includes(r.role) && (r.property_id === null || r.property_id === propertyId))
  );
  return { allowed, loading: false };
}

export const EXEC_ROLES: AppRole[] = ["super_admin", "hotel_owner", "general_manager", "accountant"];
export const SYNC_ROLES: AppRole[] = ["super_admin", "hotel_owner", "general_manager", "accountant"];
