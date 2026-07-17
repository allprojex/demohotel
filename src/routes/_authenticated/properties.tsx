import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Palette, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/properties")({
  head: () => ({ meta: [{ title: "Properties" }] }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const qc = useQueryClient();
  const props = useQuery({
    queryKey: ["properties"],
    queryFn: async () => (await supabase.from("properties").select("*").order("name")).data,
  });
  const currencies = useQuery({
    queryKey: ["currencies-all"],
    queryFn: async () => (await supabase.from("currencies").select("code,name").order("code")).data ?? [],
  });
  const currencyOptions = currencies.data ?? [{ code: "GHS", name: "Ghanaian Cedi" }];

  const updateCurrency = useMutation({
    mutationFn: async ({ id, code }: { id: string; code: string }) => {
      const { error } = await supabase
        .from("properties")
        .update({ currency: code, base_currency: code })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Property currency updated");
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Properties</h1>
          <p className="text-sm text-muted-foreground">Hotels, resorts and other properties. Default currency is Ghanaian Cedi (GHS).</p>
        </div>
        <NewProperty currencyOptions={currencyOptions} onDone={() => qc.invalidateQueries({ queryKey: ["properties"] })} />
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Currency</TableHead><TableHead>Timezone</TableHead><TableHead>Address</TableHead><TableHead>Demo</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {props.data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell>
                  <Select
                    value={p.currency ?? "GHS"}
                    onValueChange={(code) => updateCurrency.mutate({ id: p.id, code })}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencyOptions.map((c: any) => (
                        <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>{p.timezone}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{p.address ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{(p as any).is_demo ? `Until ${new Date((p as any).demo_expires_at).toLocaleDateString()}` : "Permanent"}</TableCell>
                <TableCell><CustomizeProperty property={p as any} onDone={() => qc.invalidateQueries({ queryKey: ["properties"] })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CustomizeProperty({ property, onDone }: { property: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ name: property.name ?? "", brand_tagline: property.brand_tagline ?? "", brand_primary_color: property.brand_primary_color ?? "#0f766e", address: property.address ?? "", phone: property.phone ?? "", email: property.email ?? "", website: property.website ?? "" });
  async function save() {
    setSaving(true);
    const { error } = await (supabase.from("properties") as any).update(f).eq("id", property.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Hotel customization saved"); setOpen(false); onDone();
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline"><Palette className="mr-1 h-3.5 w-3.5" />Customize</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Customize your hotel demo</DialogTitle></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Hotel name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Tagline</Label><Input value={f.brand_tagline} onChange={(e) => setF({ ...f, brand_tagline: e.target.value })} /></div>
        <div><Label>Brand colour</Label><Input type="color" value={f.brand_primary_color} onChange={(e) => setF({ ...f, brand_primary_color: e.target.value })} /></div>
        <div><Label>Phone</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Address</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div><Label>Email</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><Label>Website</Label><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Customization applies only to this evaluation workspace. Demo expiry and platform ownership cannot be changed.</p>
      <DialogFooter><Button onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : "Save customization"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function NewProperty({ onDone, currencyOptions }: { onDone: () => void; currencyOptions: { code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", code: "", currency: "GHS", timezone: "UTC", address: "" });
  async function save() {
    const { data: user } = await supabase.auth.getUser();
    const { data: prop, error } = await supabase.from("properties").insert({ ...f, base_currency: f.currency }).select().single();
    if (error) return toast.error(error.message);
    if (user.user) {
      await supabase.from("user_roles").insert({ user_id: user.user.id, role: "general_manager", property_id: prop.id });
    }
    toast.success("Property created"); setOpen(false); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New property</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New property</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><Label>Code</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
          <div>
            <Label>Currency</Label>
            <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencyOptions.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Timezone</Label><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Address</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={save}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
