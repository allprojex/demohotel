import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/accounting/periods")({
  head: () => ({ meta: [{ title: "Periods · Accounting" }] }),
  component: PeriodsPage,
});

function PeriodsPage() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    start_date: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end_date: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });

  const periods = useQuery({
    queryKey: ["periods", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("accounting_periods")
        .select("*").eq("property_id", propertyId!).order("start_date", { ascending: false });
      return data ?? [];
    },
    enabled: !!propertyId,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("accounting_periods").insert({
        property_id: propertyId!, start_date: form.start_date, end_date: form.end_date, status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Period created");
      qc.invalidateQueries({ queryKey: ["periods", propertyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "locked" | "closed" }) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("accounting_periods").update({
        status, locked_at: status === "open" ? null : new Date().toISOString(),
        locked_by: status === "open" ? null : u.user?.id ?? null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Period updated");
      qc.invalidateQueries({ queryKey: ["periods", propertyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!propertyId) return <div className="p-6 text-muted-foreground">Select a property.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-display font-semibold flex items-center gap-2"><CalendarDays className="h-6 w-6" /> Accounting Periods</h1>
      <p className="text-sm text-muted-foreground">Lock a period to block further journal posting within its date range.</p>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Create period</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end flex-wrap">
            <div><Label className="text-xs">Start</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label className="text-xs">End</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>Create</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Periods</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {(periods.data ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs">{p.start_date} → {p.end_date}</span>
                <Badge variant="outline" className={
                  p.status === "locked" || p.status === "closed"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                }>{p.status}</Badge>
                {p.locked_at && <span className="text-xs text-muted-foreground">locked {format(new Date(p.locked_at), "MMM d, HH:mm")}</span>}
              </div>
              {p.status === "open" ? (
                <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: "locked" })}><Lock className="h-3 w-3 mr-1" /> Lock</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: "open" })}><Unlock className="h-3 w-3 mr-1" /> Reopen</Button>
              )}
            </div>
          ))}
          {(periods.data ?? []).length === 0 && <div className="text-muted-foreground text-xs py-3">No periods yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
