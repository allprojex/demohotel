import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FieldDef =
  | { name: string; label: string; type: "text" | "email" | "number" | "date"; required?: boolean; placeholder?: string; min?: number; step?: number }
  | { name: string; label: string; type: "textarea"; required?: boolean; placeholder?: string; rows?: number }
  | { name: string; label: string; type: "select"; required?: boolean; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "switch" }
  | { name: string; label: string; type: "hidden" };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
  submitLabel?: string;
  submitting?: boolean;
  extra?: ReactNode;
}

export function FieldForm({ open, onOpenChange, title, fields, initial, onSubmit, submitLabel = "Save", submitting, extra }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [error, setError] = useState<string | null>(null);

  // Reset when reopening
  const handleOpenChange = (v: boolean) => {
    if (v) { setValues(initial); setError(null); }
    onOpenChange(v);
  };

  const set = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async () => {
    setError(null);
    for (const f of fields) {
      if ("required" in f && f.required) {
        const v = values[f.name];
        if (v === undefined || v === null || v === "") { setError(`${f.label} is required`); return; }
      }
    }
    try { await onSubmit(values); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          {fields.map((f) => {
            if (f.type === "hidden") return null;
            const v = values[f.name];
            return (
              <div key={f.name} className="space-y-1">
                <Label>{f.label}{"required" in f && f.required ? <span className="text-destructive"> *</span> : null}</Label>
                {f.type === "text" || f.type === "email" ? (
                  <Input type={f.type} value={(v as string) ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                ) : f.type === "number" ? (
                  <Input type="number" min={f.min} step={f.step ?? "any"} value={(v as string | number) ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value === "" ? null : Number(e.target.value))} />
                ) : f.type === "date" ? (
                  <Input type="date" value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} />
                ) : f.type === "textarea" ? (
                  <Textarea rows={f.rows ?? 3} value={(v as string) ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
                ) : f.type === "select" ? (
                  <Select value={(v as string) ?? ""} onValueChange={(val) => set(f.name, val)}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>{f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : f.type === "switch" ? (
                  <div className="flex items-center gap-2 pt-1"><Switch checked={!!v} onCheckedChange={(c) => set(f.name, c)} /><span className="text-xs text-muted-foreground">{v ? "Enabled" : "Disabled"}</span></div>
                ) : null}
              </div>
            );
          })}
          {extra}
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
