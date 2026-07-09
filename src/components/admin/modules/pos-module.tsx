import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Utensils, Coffee, Layers, LayoutGrid } from "lucide-react";
import { CrudTable } from "@/components/admin/crud-table";
import { DeleteConfirm } from "@/components/admin/delete-confirm";
import { FieldForm } from "@/components/admin/field-form";
import { useEntityCrud } from "@/lib/admin/use-entity-crud";

interface Props { propertyId: string | null; }

export function PosModule({ propertyId }: Props) {
  if (!propertyId) return <div className="text-sm text-muted-foreground p-6">Select a property to manage POS.</div>;
  return (
    <div className="space-y-4">
      <OutletsSection propertyId={propertyId} />
      <CategoriesSection propertyId={propertyId} />
      <MenuItemsSection propertyId={propertyId} />
      <TablesSection propertyId={propertyId} />
    </div>
  );
}

function OutletsSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<any | null>(null);
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "pos_outlets", queryKey: ["admin", "pos_outlets", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Outlet",
  });
  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "code", label: "Code", type: "text" as const },
    { name: "type", label: "Type", type: "select" as const, options: ["restaurant","bar","room_service","other"].map((s) => ({ value: s, label: s })) },
    { name: "tax_rate", label: "Tax rate (%)", type: "number" as const, min: 0 },
    { name: "is_active", label: "Active", type: "switch" as const },
  ];
  const submit = async (v: Record<string, unknown>) => {
    const payload = { ...v, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };
  return (
    <>
      <CrudTable title="Outlets" icon={<Utensils className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New outlet"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Type", cell: (r) => <Badge variant="outline">{r.type}</Badge>, printValue: (r) => r.type },
          { label: "Tax", cell: (r) => `${Number(r.tax_rate ?? 0).toFixed(2)}%`, num: true, printValue: (r) => `${Number(r.tax_rate ?? 0).toFixed(2)}%` },
          { label: "Active", cell: (r) => r.is_active ? "Yes" : "No", printValue: (r) => r.is_active ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit outlet" : "New outlet"} fields={fields} initial={editing ?? { is_active: true, tax_rate: 10, type: "restaurant" }} onSubmit={submit} submitting={create.isPending || update.isPending} />
    </>
  );
}

function CategoriesSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<any | null>(null);
  const { list: outlets } = useEntityCrud<any>({
    table: "pos_outlets", queryKey: ["admin", "pos_outlets", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" },
  });
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "pos_menu_categories", queryKey: ["admin", "pos_menu_categories", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Category",
  });
  const outletMap = new Map((outlets.data ?? []).map((o) => [o.id, o.name]));
  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "outlet_id", label: "Outlet", type: "select" as const, required: true, options: (outlets.data ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { name: "sort_order", label: "Sort order", type: "number" as const },
  ];
  const submit = async (v: Record<string, unknown>) => {
    const payload = { ...v, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };
  return (
    <>
      <CrudTable title="Menu Categories" icon={<Layers className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New category"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Outlet", cell: (r) => outletMap.get(r.outlet_id) ?? "—", printValue: (r) => outletMap.get(r.outlet_id) },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit category" : "New category"} fields={fields} initial={editing ?? {}} onSubmit={submit} submitting={create.isPending || update.isPending} />
    </>
  );
}

function MenuItemsSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<any | null>(null);
  const { list: cats } = useEntityCrud<any>({
    table: "pos_menu_categories", queryKey: ["admin", "pos_menu_categories", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" },
  });
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "pos_menu_items", queryKey: ["admin", "pos_menu_items", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Menu item",
  });
  const catMap = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "sku", label: "SKU", type: "text" as const },
    { name: "category_id", label: "Category", type: "select" as const, required: true, options: (cats.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: "price", label: "Price", type: "number" as const, required: true, min: 0 },
    { name: "cost", label: "Cost", type: "number" as const, min: 0 },
    { name: "description", label: "Description", type: "textarea" as const },
    { name: "is_active", label: "Active", type: "switch" as const },
  ];
  const submit = async (v: Record<string, unknown>) => {
    const payload = { ...v, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };
  return (
    <>
      <CrudTable title="Menu Items" icon={<Coffee className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New item"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "SKU", cell: (r) => <span className="font-mono text-xs">{r.sku ?? "—"}</span>, printValue: (r) => r.sku },
          { label: "Category", cell: (r) => catMap.get(r.category_id) ?? "—", printValue: (r) => catMap.get(r.category_id) },
          { label: "Price", cell: (r) => Number(r.price).toFixed(2), num: true, printValue: (r) => Number(r.price).toFixed(2) },
          { label: "Active", cell: (r) => r.is_active ? "Yes" : "No", printValue: (r) => r.is_active ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit item" : "New item"} fields={fields} initial={editing ?? { is_active: true, price: 0 }} onSubmit={submit} submitting={create.isPending || update.isPending} />
    </>
  );
}

function TablesSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<any | null>(null);
  const { list: outlets } = useEntityCrud<any>({
    table: "pos_outlets", queryKey: ["admin", "pos_outlets", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" },
  });
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "pos_tables", queryKey: ["admin", "pos_tables", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Table",
  });
  const outletMap = new Map((outlets.data ?? []).map((o) => [o.id, o.name]));
  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "outlet_id", label: "Outlet", type: "select" as const, required: true, options: (outlets.data ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { name: "capacity", label: "Capacity", type: "number" as const, min: 1 },
    { name: "status", label: "Status", type: "select" as const, options: ["free","occupied","reserved"].map((s) => ({ value: s, label: s })) },
  ];
  const submit = async (v: Record<string, unknown>) => {
    const payload = { ...v, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };
  return (
    <>
      <CrudTable title="Tables" icon={<LayoutGrid className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New table"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Outlet", cell: (r) => outletMap.get(r.outlet_id) ?? "—", printValue: (r) => outletMap.get(r.outlet_id) },
          { label: "Capacity", cell: (r) => r.capacity ?? "—", num: true, printValue: (r) => r.capacity },
          { label: "Status", cell: (r) => <Badge variant="outline">{r.status}</Badge>, printValue: (r) => r.status },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit table" : "New table"} fields={fields} initial={editing ?? { capacity: 4, status: "free" }} onSubmit={submit} submitting={create.isPending || update.isPending} />
    </>
  );
}
