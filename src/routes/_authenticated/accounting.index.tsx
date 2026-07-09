import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, TrendingUp, ArrowUpRight, ArrowDownRight, Lock } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";

export const Route = createFileRoute("/_authenticated/accounting/")({
  head: () => ({ meta: [{ title: "Accounting · Infinity Techub PMS" }] }),
  component: AccountingOverview,
});

function fmt(n: number, cur = "GHS") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
}

function AccountingOverview() {
  const propertyId = useActiveProperty();
  const from = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const to = format(endOfMonth(new Date()), "yyyy-MM-dd");

  const pl = useQuery({
    queryKey: ["pl", propertyId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_profit_loss", {
        _property_id: propertyId!, _from: from, _to: to,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });

  const bs = useQuery({
    queryKey: ["bs", propertyId, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_balance_sheet", {
        _property_id: propertyId!, _as_of: to,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!propertyId,
  });

  const recent = useQuery({
    queryKey: ["recent-je", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("journal_entries")
        .select("id, entry_date, memo, source, currency")
        .eq("property_id", propertyId!)
        .order("entry_date", { ascending: false }).limit(6);
      return data ?? [];
    },
    enabled: !!propertyId,
  });

  const revenue = (pl.data ?? []).filter((r: any) => r.type === "revenue").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const expense = (pl.data ?? []).filter((r: any) => r.type === "expense").reduce((s: number, r: any) => s + Number(r.amount), 0);
  const netIncome = revenue - expense;
  const cash = (bs.data ?? []).filter((r: any) => r.type === "asset" && (r.code === "1000" || r.code === "1010")).reduce((s: number, r: any) => s + Number(r.balance), 0);
  const ar = (bs.data ?? []).filter((r: any) => r.code === "1200").reduce((s: number, r: any) => s + Number(r.balance), 0);
  const ap = (bs.data ?? []).filter((r: any) => r.code === "2000").reduce((s: number, r: any) => s + Number(r.balance), 0);

  if (!propertyId) return <div className="p-6 text-muted-foreground">Select a property to view accounting.</div>;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Accounting</h1>
          <p className="text-sm text-muted-foreground">Current month: {format(new Date(), "MMMM yyyy")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/accounting/journal">Journal</Link></Button>
          <Button asChild size="sm"><Link to="/accounting/reports">Reports</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Revenue MTD" value={fmt(revenue)} icon={<ArrowUpRight className="h-4 w-4 text-emerald-500" />} />
        <StatCard label="Expenses MTD" value={fmt(expense)} icon={<ArrowDownRight className="h-4 w-4 text-destructive" />} />
        <StatCard label="Net Income" value={fmt(netIncome)} highlight={netIncome >= 0 ? "positive" : "negative"} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Cash on hand" value={fmt(cash)} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Working Capital</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Accounts Receivable" value={fmt(ar)} />
            <Row label="Accounts Payable" value={fmt(ap)} />
            <Row label="Net" value={fmt(ar - ap)} bold />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Recent Journal Entries</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-6 text-xs"><Link to="/accounting/journal">View all</Link></Button>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {(recent.data ?? []).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between border-b py-1.5 last:border-0">
                <div className="min-w-0">
                  <div className="truncate">{e.memo ?? "(no memo)"}</div>
                  <div className="text-xs text-muted-foreground">{e.entry_date} · {e.source}</div>
                </div>
                <span className="text-xs font-mono text-muted-foreground">{e.currency}</span>
              </div>
            ))}
            {(recent.data ?? []).length === 0 && <div className="text-muted-foreground text-xs">No entries yet.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4" /> Close of Day</CardTitle>
          <Button asChild variant="outline" size="sm"><Link to="/accounting/periods">Manage periods</Link></Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Lock accounting periods to prevent further posting. Coming in Phase 2: automated night-audit run with cash drawer reconciliation.
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon?: React.ReactNode; highlight?: "positive" | "negative" }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
        <div className={`text-2xl font-display font-semibold mt-1 ${highlight === "negative" ? "text-destructive" : highlight === "positive" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold pt-1 border-t" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
