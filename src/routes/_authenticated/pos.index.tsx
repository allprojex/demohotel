import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Utensils, Wine, Coffee } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pos/")({
  head: () => ({ meta: [{ title: "POS Terminal" }] }),
  component: PosHome,
});

const KIND_ICON: Record<string, any> = { restaurant: Utensils, bar: Wine, room_service: Coffee, other: Utensils };

function PosHome() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();
  const outlets = useQuery({
    queryKey: ["pos-outlets", propertyId], enabled: !!propertyId,
    queryFn: async () => (await (supabase.from as any)("pos_outlets").select("*").eq("property_id", propertyId).eq("active", true).order("name")).data ?? [],
  });
  const [outletId, setOutletId] = useState<string>("");
  const currentOutlet = outlets.data?.find((o: any) => o.id === outletId) ?? outlets.data?.[0];
  const active = currentOutlet?.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">POS Terminal</h1>
          <p className="text-sm text-muted-foreground">Take orders, fire KOTs and settle payments.</p>
        </div>
        <div className="flex gap-2">
          {outlets.data && outlets.data.length > 0 && (
            <Select value={active ?? ""} onValueChange={setOutletId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Choose outlet" /></SelectTrigger>
              <SelectContent>{outlets.data.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <OutletDialog propertyId={propertyId} onDone={() => qc.invalidateQueries({ queryKey: ["pos-outlets", propertyId] })} />
        </div>
      </div>

      {!active ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          Create your first POS outlet to get started (Restaurant, Bar, Room Service, etc.).
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="tables">
          <TabsList>
            <TabsTrigger value="tables">Tables</TabsTrigger>
            <TabsTrigger value="orders">Open orders</TabsTrigger>
          </TabsList>
          <TabsContent value="tables"><TablesGrid propertyId={propertyId!} outlet={currentOutlet} /></TabsContent>
          <TabsContent value="orders"><OpenOrders propertyId={propertyId!} outletId={active} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function OutletDialog({ propertyId, onDone }: any) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("restaurant");
  const [tax, setTax] = useState(0);
  async function save() {
    if (!propertyId || !name.trim()) return;
    const { error } = await (supabase.from as any)("pos_outlets").insert({ property_id: propertyId, name, kind, tax_rate: tax });
    if (error) return toast.error(error.message);
    toast.success("Outlet created"); setOpen(false); setName(""); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1" /> New outlet</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New POS outlet</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset Restaurant" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["restaurant","bar","room_service","other"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Tax rate %</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(+e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={save}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TablesGrid({ propertyId, outlet }: { propertyId: string; outlet: any }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const tables = useQuery({
    queryKey: ["pos-tables", outlet.id], enabled: !!outlet.id,
    queryFn: async () => (await (supabase.from as any)("pos_tables").select("*").eq("outlet_id", outlet.id).order("label")).data ?? [],
  });
  const openOrders = useQuery({
    queryKey: ["pos-open-orders", outlet.id], enabled: !!outlet.id,
    queryFn: async () => (await (supabase.from as any)("pos_orders").select("id,table_id,code").eq("outlet_id", outlet.id).in("status", ["open","sent","served"])).data ?? [],
  });
  const orderByTable = new Map<string, any>();
  openOrders.data?.forEach((o: any) => { if (o.table_id) orderByTable.set(o.table_id, o); });

  async function openOrder(tableId: string | null) {
    // find existing open order for this table
    if (tableId) {
      const existing = orderByTable.get(tableId);
      if (existing) return nav({ to: "/pos/order/$id", params: { id: existing.id } });
    }
    const { data, error } = await (supabase.from as any)("pos_orders").insert({
      property_id: propertyId, outlet_id: outlet.id, table_id: tableId, status: "open",
    }).select("id").single();
    if (error) return toast.error(error.message);
    if (tableId) await (supabase.from as any)("pos_tables").update({ status: "occupied" }).eq("id", tableId);
    qc.invalidateQueries({ queryKey: ["pos-tables", outlet.id] });
    nav({ to: "/pos/order/$id", params: { id: data.id } });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Tap a table to open its order, or start a takeaway.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openOrder(null)}>Takeaway / Walk-in</Button>
          <NewTableDialog propertyId={propertyId} outletId={outlet.id} onDone={() => qc.invalidateQueries({ queryKey: ["pos-tables", outlet.id] })} />
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {tables.data?.map((t: any) => {
          const hasOrder = orderByTable.has(t.id);
          return (
            <button key={t.id} onClick={() => openOrder(t.id)}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${hasOrder || t.status === "occupied" ? "bg-primary/10 border-primary" : "bg-card border-border hover:border-primary"}`}>
              <div className="text-lg font-semibold">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.seats} seats</div>
              <Badge className="mt-2" variant={hasOrder ? "default" : "outline"}>{hasOrder ? "In use" : "Free"}</Badge>
            </button>
          );
        })}
        {tables.data?.length === 0 && <Card className="col-span-full"><CardContent className="p-8 text-center text-muted-foreground">No tables yet. Add one to get started.</CardContent></Card>}
      </div>
    </div>
  );
}

function NewTableDialog({ propertyId, outletId, onDone }: any) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState(4);
  async function save() {
    if (!label.trim()) return;
    const { error } = await (supabase.from as any)("pos_tables").insert({ property_id: propertyId, outlet_id: outletId, label, seats });
    if (error) return toast.error(error.message);
    toast.success("Table added"); setOpen(false); setLabel(""); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Table</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New table</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T-01" /></div>
          <div><Label>Seats</Label><Input type="number" value={seats} onChange={(e) => setSeats(+e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenOrders({ propertyId: _p, outletId }: { propertyId: string; outletId: string }) {
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ["pos-orders-list", outletId], enabled: !!outletId,
    queryFn: async () => (await (supabase.from as any)("pos_orders").select("*, pos_tables(label)").eq("outlet_id", outletId).in("status", ["open","sent","served"]).order("opened_at", { ascending: false })).data ?? [],
  });
  return (
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Table</TableHead><TableHead>Guest</TableHead><TableHead>Opened</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {list.data?.map((o: any) => (
            <TableRow key={o.id}>
              <TableCell className="font-mono text-xs">{o.code}</TableCell>
              <TableCell>{o.pos_tables?.label ?? "—"}</TableCell>
              <TableCell>{o.guest_name ?? "—"}</TableCell>
              <TableCell>{new Date(o.opened_at).toLocaleTimeString()}</TableCell>
              <TableCell><Badge>{o.status}</Badge></TableCell>
              <TableCell className="text-right">{Number(o.total).toFixed(2)}</TableCell>
              <TableCell className="text-right"><Button size="sm" onClick={() => nav({ to: "/pos/order/$id", params: { id: o.id } })}>Open</Button></TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No open orders.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}
