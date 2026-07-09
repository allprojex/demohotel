import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GuestIdTypeSelect({
  propertyId, value, onChange,
}: { propertyId: string | null; value?: string | null; onChange: (id: string) => void }) {
  const q = useQuery({
    queryKey: ["guest-id-types", propertyId],
    queryFn: async () => {
      let qb = supabase.from("guest_id_types" as any).select("id,name,code,active").eq("active", true);
      if (propertyId) qb = qb.or(`property_id.eq.${propertyId},property_id.is.null`);
      else qb = qb.is("property_id", null);
      const { data, error } = await qb.order("name");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select ID type" /></SelectTrigger>
      <SelectContent>
        {(q.data ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
