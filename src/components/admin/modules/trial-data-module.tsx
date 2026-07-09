import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Beaker, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { seedTrialData, purgeTrialData, trialDataCounts } from "@/lib/admin/trial-data.functions";
import { useHasAnyRole } from "@/hooks/use-user-roles";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Props { propertyId: string | null; }

export function TrialDataModule({ propertyId }: Props) {
  const qc = useQueryClient();
  const isSuper = useHasAnyRole(["super_admin"] as any, null);
  const seedFn = useServerFn(seedTrialData);
  const purgeFn = useServerFn(purgeTrialData);
  const countsFn = useServerFn(trialDataCounts);
  const [busy, setBusy] = useState<"seed" | "purge" | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const counts = useQuery({
    queryKey: ["trial-counts", propertyId],
    enabled: !!propertyId && !!isSuper.allowed,
    queryFn: () => countsFn({ data: { propertyId: propertyId! } }),
  });

  if (!propertyId) return <div className="p-6 text-sm text-muted-foreground">Select a property first.</div>;
  if (isSuper.loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isSuper.allowed) {
    return (
      <Card><CardContent className="p-6 text-sm text-muted-foreground">
        Only a System Super Admin can seed or purge trial data.
      </CardContent></Card>
    );
  }

  async function onSeed() {
    setBusy("seed");
    try {
      const r = await seedFn({ data: { propertyId: propertyId! } });
      toast.success(`Seeded ${r.items} items, ${r.suppliers} suppliers, ${r.orders} POS sales`);
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Seed failed");
    } finally { setBusy(null); }
  }
  async function onPurge() {
    setBusy("purge"); setPurgeOpen(false);
    try {
      await purgeFn({ data: { propertyId: propertyId! } });
      toast.success("All trial data removed");
      await qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Purge failed");
    } finally { setBusy(null); }
  }

  const c = counts.data;
  const totalTest = c ? c.items + c.suppliers + c.outlets + c.orders + c.adjustments + c.notifications : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 text-primary p-2"><Beaker className="h-5 w-5" /></div>
            <div>
              <CardTitle>Trial / smoke-test data</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Every row is tagged with <code className="text-[11px]">[TEST]</code> or SKU <code className="text-[11px]">TEST-</code> and can be purged before go-live.
              </p>
            </div>
          </div>
          <Badge variant={totalTest > 0 ? "default" : "outline"}>{totalTest} test rows</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {c && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <Cnt label="Items" v={c.items} /><Cnt label="Suppliers" v={c.suppliers} />
              <Cnt label="Outlets" v={c.outlets} /><Cnt label="POS orders" v={c.orders} />
              <Cnt label="Stock adj." v={c.adjustments} /><Cnt label="Notifications" v={c.notifications} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={onSeed} disabled={busy !== null}>
              {busy === "seed" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Beaker className="h-4 w-4 mr-2" />}
              Seed trial data
            </Button>
            <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" disabled={busy !== null || totalTest === 0}>
                  <Trash2 className="h-4 w-4 mr-2" /> Purge trial data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Purge trial data?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes every row tagged <code>[TEST]</code> or SKU <code>TEST-</code> in this property,
                    including POS orders, stock adjustments, suppliers, inventory items and your seed notifications. Real data is untouched.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setPurgeOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={onPurge}>Purge now</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="text-xs text-muted-foreground">
            Seeding creates 5 products, 2 suppliers, initial stocking, 3 closed POS sales (with payments) and a bell notification.
            Use the dashboard, inventory and POS pages to verify totals reflect the trial run, then purge before deployment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Cnt({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{v}</div>
    </div>
  );
}
