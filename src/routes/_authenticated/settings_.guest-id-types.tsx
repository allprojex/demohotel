import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings_/guest-id-types")({
  head: () => ({ meta: [{ title: "Guest Identification Types" }] }),
  component: GuestIdTypes,
});

function GuestIdTypes() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const list = useQuery({
    queryKey: ["guest-id-types-admin", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("guest_id_types" as any).select("*").order("name");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  async function add() {
    if (!propertyId || !name || !code) return toast.error("Name and code required");
    const { error } = await (supabase.from("guest_id_types" as any) as any).insert({
      property_id: propertyId, name, code: code.toLowerCase().replace(/\s+/g,"_"), is_system: false,
    });
    if (error) return toast.error(error.message);
    toast.success("Added"); setName(""); setCode("");
    qc.invalidateQueries({ queryKey: ["guest-id-types-admin"] });
  }

  async function remove(id: string) {
    if (!confirm("Delete this ID type?")) return;
    const { error } = await supabase.from("guest_id_types" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["guest-id-types-admin"] });
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Guest Identification Types</h1>
        <p className="text-sm text-muted-foreground">Ghana identification types are pre-loaded; add your own for foreign nationals.</p>
      </div>
      <Card className="p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1"><label className="text-xs">Name</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Residence permit" /></div>
          <div className="w-40"><label className="text-xs">Code</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="residence" /></div>
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Scope</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(list.data ?? []).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-xs font-mono">{t.code}</TableCell>
                <TableCell>{t.is_system ? <Badge variant="secondary">System</Badge> : <Badge>Property</Badge>}</TableCell>
                <TableCell className="text-right">
                  {!t.is_system && <Button size="icon" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
