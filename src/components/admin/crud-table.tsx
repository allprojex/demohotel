import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Printer, Search } from "lucide-react";
import { openPrintView, renderTable, escapeHtml } from "@/lib/admin/print-html";

export interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  /** for search + print */
  searchValue?: (row: T) => string;
  printValue?: (row: T) => unknown;
  num?: boolean;
  width?: string;
}

interface Props<T> {
  title: string;
  icon?: ReactNode;
  rows: T[] | undefined;
  loading?: boolean;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowActions?: (row: T) => ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  printTitle?: string;
  extraToolbar?: ReactNode;
  emptyText?: string;
}

export function CrudTable<T>({
  title, icon, rows, loading, columns, rowKey, rowActions, onAdd, addLabel = "New",
  printTitle, extraToolbar, emptyText = "No records.",
}: Props<T>) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      columns.some((c) => {
        const v = c.searchValue ? c.searchValue(r) : "";
        return String(v).toLowerCase().includes(needle);
      }),
    );
  }, [rows, q, columns]);

  const handlePrint = () => {
    const printCols = columns
      .filter((c) => c.printValue !== undefined || c.searchValue !== undefined)
      .map((c) => ({
        label: c.label,
        key: (r: T) => (c.printValue ? c.printValue(r) : c.searchValue ? c.searchValue(r) : ""),
        num: c.num,
      }));
    const body = renderTable(printCols, filtered);
    openPrintView({
      title: printTitle ?? title,
      subtitle: `${filtered.length} record${filtered.length === 1 ? "" : "s"}${q ? ` matching "${escapeHtml(q)}"` : ""}`,
      bodyHtml: body,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}<span className="text-xs font-normal text-muted-foreground ml-2">{filtered.length}</span></CardTitle>
        <div className="flex items-center gap-1">
          {extraToolbar}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 pl-7 w-40 text-xs" />
          </div>
          <Button size="sm" variant="outline" onClick={handlePrint} className="h-8"><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
          {onAdd && <Button size="sm" onClick={onAdd} className="h-8"><Plus className="h-3.5 w-3.5 mr-1" />{addLabel}</Button>}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.label} style={c.width ? { width: c.width } : undefined} className={c.num ? "text-right" : ""}>{c.label}</TableHead>)}
                {rowActions && <TableHead className="w-1">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-6">{emptyText}</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={rowKey(r)}>
                  {columns.map((c) => <TableCell key={c.label} className={c.num ? "text-right tabular-nums" : ""}>{c.cell(r)}</TableCell>)}
                  {rowActions && <TableCell className="whitespace-nowrap"><div className="flex items-center gap-0.5">{rowActions(r)}</div></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
