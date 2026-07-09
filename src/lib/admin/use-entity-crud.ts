import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Shared query+CRUD builder for admin tables. Uses direct supabase client (RLS enforced). */
export function useEntityCrud<T extends { id: string }>(opts: {
  table: string;
  queryKey: QueryKey;
  select?: string;
  filter?: (q: any) => any;
  order?: { column: string; ascending?: boolean };
  enabled?: boolean;
  label?: string;
}) {
  const qc = useQueryClient();
  const label = opts.label ?? opts.table;

  const list = useQuery({
    queryKey: opts.queryKey,
    enabled: opts.enabled !== false,
    queryFn: async () => {
      let q: any = supabase.from(opts.table as any).select(opts.select ?? "*");
      if (opts.filter) q = opts.filter(q);
      if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: opts.queryKey });

  const create = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const { data, error } = await (supabase.from(opts.table as any) as any).insert(values).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success(`${label} added`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Record<string, unknown> }) => {
      const { error } = await (supabase.from(opts.table as any) as any).update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${label} updated`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(opts.table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${label} deleted`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { list, create, update, remove, invalidate };
}
