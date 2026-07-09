import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rooms/")({
  head: () => ({ meta: [{ title: "Rooms" }] }),
  component: RoomsPage,
});

const STATUS_MAP: Record<string, string> = {
  available: "secondary", occupied: "default", blocked: "outline", out_of_order: "destructive",
};
const HK_MAP: Record<string, string> = {
  clean: "secondary", inspected: "default", dirty: "outline", maintenance: "destructive",
};

function RoomsPage() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();

  const rooms = useQuery({
    queryKey: ["rooms", propertyId],
    enabled: !!propertyId,
    queryFn: async () => (await supabase.from("rooms").select("*, room_types(name)").eq("property_id", propertyId!).order("number")).data,
  });

  async function update(id: string, patch: any) {
    const { error } = await supabase.from("rooms").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Rooms</h1>
        <p className="text-sm text-muted-foreground">Manage room status and housekeeping state.</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Room</TableHead><TableHead>Type</TableHead><TableHead>Floor</TableHead>
              <TableHead>Status</TableHead><TableHead>Housekeeping</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.data?.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.number}</TableCell>
                <TableCell>{r.room_types?.name}</TableCell>
                <TableCell>{r.floor ?? "—"}</TableCell>
                <TableCell>
                  <Select value={r.status} onValueChange={(v) => update(r.id, { status: v })}>
                    <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="occupied">Occupied</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      <SelectItem value="out_of_order">Out of order</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={r.housekeeping_status} onValueChange={(v) => update(r.id, { housekeeping_status: v })}>
                    <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clean">Clean</SelectItem>
                      <SelectItem value="inspected">Inspected</SelectItem>
                      <SelectItem value="dirty">Dirty</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
