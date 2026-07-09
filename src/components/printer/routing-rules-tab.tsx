import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listRoutingRules, saveRoutingRule, deleteRoutingRule, toggleRoutingRule,
  previewRoutingForProperty,
} from "@/lib/printer/routing.functions";
import { listPrinters } from "@/lib/printer/printers.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Route, Eye, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";


const JOB_TYPES = ["receipt", "invoice", "label", "barcode", "report", "document", "kot", "bill"];

export function RoutingRulesTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRoutingRules);
  const saveFn = useServerFn(saveRoutingRule);
  const delFn = useServerFn(deleteRoutingRule);
  const toggleFn = useServerFn(toggleRoutingRule);
  const printersFn = useServerFn(listPrinters);
  const previewFn = useServerFn(previewRoutingForProperty);


  const [jobType, setJobType] = useState("receipt");
  const [printerId, setPrinterId] = useState("");
  const [priority, setPriority] = useState<number>(0);

  const rules = useQuery({
    queryKey: ["routing-rules", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
  });
  const printers = useQuery({ queryKey: ["printers"], queryFn: () => printersFn() });
  const printerMap = new Map((printers.data ?? []).map((p) => [p.id, p]));

  const preview = useQuery({
    queryKey: ["routing-preview", propertyId],
    queryFn: () => previewFn({ data: { propertyId, jobTypes: JOB_TYPES } }),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["routing-rules"] });
    qc.invalidateQueries({ queryKey: ["routing-preview"] });
    qc.invalidateQueries({ queryKey: ["printers"] });
  };

  const save = useMutation({
    mutationFn: () => saveFn({ data: { propertyId, jobType, printerId, priority } }),
    onSuccess: () => {
      refreshAll();
      setPrinterId("");
      toast.success("Routing rule saved.");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed."),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { refreshAll(); toast.success("Rule removed."); },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => toggleFn({ data: v }),
    onSuccess: () => refreshAll(),
  });

  const grouped: Record<string, typeof rules.data extends undefined ? never : NonNullable<typeof rules.data>> = {};
  for (const r of rules.data ?? []) {
    (grouped[r.job_type] ??= [] as any).push(r);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Route className="h-4 w-4" />Add routing rule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Job type</Label>
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Printer</Label>
              <Select value={printerId} onValueChange={setPrinterId}>
                <SelectTrigger><SelectValue placeholder="Select printer" /></SelectTrigger>
                <SelectContent>
                  {(printers.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.kind})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority (lower = tried first)</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(+e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => save.mutate()} disabled={!printerId || save.isPending} className="w-full gap-1.5">
                <Plus className="h-3.5 w-3.5" />{save.isPending ? "Saving…" : "Add rule"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            At print time, the app picks the first active printer for a job type (by priority) that isn't in an error state. If no rule matches, it falls back to the property's default printer.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />Routing preview
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["routing-preview"] })}
            disabled={preview.isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${preview.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job type</TableHead>
                <TableHead>Selected printer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Candidates considered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(preview.data ?? []).map((row) => {
                const icon =
                  row.reason === "none" ? <XCircle className="h-3.5 w-3.5 text-destructive" /> :
                  row.reason === "rule-fallback-error" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> :
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
                const reasonLabel =
                  row.reason === "rule" ? "matched rule" :
                  row.reason === "rule-fallback-error" ? "all rule printers in error — using first rule anyway" :
                  row.reason === "default" ? "no rule — using property default" :
                  "no rule and no default printer";
                return (
                  <TableRow key={row.job_type}>
                    <TableCell className="text-xs uppercase font-medium">{row.job_type}</TableCell>
                    <TableCell className="text-xs">
                      {row.selected_printer_name ? (
                        <>
                          {row.selected_printer_name}{" "}
                          <span className="text-muted-foreground">({row.selected_printer_kind})</span>
                        </>
                      ) : (
                        <span className="text-destructive">— nothing will print —</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {icon}
                        {row.selected_printer_status && (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {row.selected_printer_status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{reasonLabel}</TableCell>
                    <TableCell className="text-xs">
                      {row.candidates.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {row.candidates.map((c, i) => (
                            <div key={`${c.printer_id}-${i}`} className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px]">p{c.priority}</Badge>
                              <span className={c.skipped ? "line-through text-muted-foreground" : ""}>
                                {c.printer_name}
                              </span>
                              {c.skipped && (
                                <span className="text-[10px] text-amber-600">({c.skip_reason})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active routing rules</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job type</TableHead>
                <TableHead>Printer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {JOB_TYPES.map((jt) => {
                const rows = grouped[jt] ?? [];
                if (rows.length === 0) {
                  return (
                    <TableRow key={jt}>
                      <TableCell className="text-xs uppercase">{jt}</TableCell>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        No rule — falls back to default printer.
                      </TableCell>
                    </TableRow>
                  );
                }
                return rows.map((r, i) => {
                  const p = printerMap.get(r.printer_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs uppercase">{i === 0 ? jt : ""}</TableCell>
                      <TableCell className="text-xs">
                        {p?.name ?? "(deleted)"} <span className="text-muted-foreground">({p?.kind ?? "?"})</span>
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.priority}</Badge></TableCell>
                      <TableCell>
                        <Switch
                          checked={r.is_active}
                          onCheckedChange={(v) => toggle.mutate({ id: r.id, isActive: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                });
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
