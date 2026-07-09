import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, CircleCheck, CircleDot, Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/housekeeping")({
  head: () => ({ meta: [{ title: "Housekeeping" }] }),
  component: HKPage,
});

const HK_ORDER = ["dirty", "clean", "inspected", "maintenance"] as const;
const HK_META = {
  dirty: { label: "Dirty", icon: CircleDot, color: "text-warning" },
  clean: { label: "Clean", icon: Sparkles, color: "text-info" },
  inspected: { label: "Inspected", icon: CircleCheck, color: "text-success" },
  maintenance: { label: "Maintenance", icon: Wrench, color: "text-destructive" },
} as const;

function HKPage() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();
  const rooms = useQuery({
    queryKey: ["hk-rooms", propertyId], enabled: !!propertyId,
    queryFn: async () => (await supabase.from("rooms").select("*, room_types(name)").eq("property_id", propertyId!).order("number")).data,
  });

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("rooms").update({ housekeeping_status: status as any }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["hk-rooms", propertyId] });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Housekeeping</h1>
        <p className="text-sm text-muted-foreground">Room cleaning status board.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {HK_ORDER.map((k) => {
          const list = (rooms.data ?? []).filter((r: any) => r.housekeeping_status === k);
          const Meta = HK_META[k];
          return (
            <Card key={k}>
              <div className="border-b px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Meta.icon className={`h-4 w-4 ${Meta.color}`} />
                  <span className="font-medium text-sm">{Meta.label}</span>
                </div>
                <Badge variant="secondary">{list.length}</Badge>
              </div>
              <CardContent className="p-3 space-y-2 max-h-[65vh] overflow-auto">
                {list.map((r: any) => (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">Room {r.number}</div>
                        <div className="text-xs text-muted-foreground">{r.room_types?.name}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {HK_ORDER.filter((s) => s !== k).map((s) => (
                        <Button key={s} size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStatus(r.id, s)}>→ {HK_META[s].label}</Button>
                      ))}
                    </div>
                  </div>
                ))}
                {list.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No rooms.</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
