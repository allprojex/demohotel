import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Building2, BedDouble, DoorOpen, Tag } from "lucide-react";
import { CrudTable } from "@/components/admin/crud-table";
import { DeleteConfirm } from "@/components/admin/delete-confirm";
import { FieldForm } from "@/components/admin/field-form";
import { useEntityCrud } from "@/lib/admin/use-entity-crud";

interface Props { propertyId: string | null; }

export function PropertiesModule({ propertyId }: Props) {
  return (
    <div className="space-y-4">
      <PropertiesSection />
      {propertyId && <>
        <RoomTypesSection propertyId={propertyId} />
        <RoomsSection propertyId={propertyId} />
        <RatePlansSection propertyId={propertyId} />
      </>}
    </div>
  );
}

// ---------- Properties ----------
function PropertiesSection() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { list, create, update, remove } = useEntityCrud<any>({
    table: "properties", queryKey: ["admin", "properties"], order: { column: "name" }, label: "Property",
  });

  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "code", label: "Code", type: "text" as const },
    { name: "base_currency", label: "Base currency", type: "text" as const, placeholder: "GHS" },
    { name: "timezone", label: "Timezone", type: "text" as const, placeholder: "UTC" },
    { name: "address", label: "Address", type: "textarea" as const },
    { name: "phone", label: "Phone", type: "text" as const },
    { name: "email", label: "Email", type: "email" as const },
    { name: "website", label: "Website", type: "text" as const },
    { name: "is_public", label: "Public listing", type: "switch" as const },
    { name: "active", label: "Active", type: "switch" as const },
  ];

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (editing) { await update.mutateAsync({ id: editing.id, values }); }
    else { await create.mutateAsync(values); }
    setOpen(false); setEditing(null);
  };

  return (
    <>
      <CrudTable
        title="Properties"
        icon={<Building2 className="h-4 w-4" />}
        rows={list.data}
        loading={list.isLoading}
        rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }}
        addLabel="New property"
        columns={[
          { label: "Name", cell: (r) => <div className="font-medium">{r.name}</div>, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>, printValue: (r) => r.code },
          { label: "Currency", cell: (r) => r.base_currency, printValue: (r) => r.base_currency },
          { label: "Public", cell: (r) => r.is_public ? <Badge variant="outline">Yes</Badge> : "—", printValue: (r) => r.is_public ? "Yes" : "No" },
          { label: "Active", cell: (r) => r.active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>, printValue: (r) => r.active ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm requireTyped={r.name} title={`Delete property "${r.name}"?`} description="This will remove the property. Related records will fail if references still exist." onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm
        open={open} onOpenChange={setOpen}
        title={editing ? "Edit property" : "New property"}
        fields={fields}
        initial={editing ?? { is_public: false, active: true, base_currency: "GHS", timezone: "UTC" }}
        onSubmit={handleSubmit}
        submitting={create.isPending || update.isPending}
      />
    </>
  );
}

// ---------- Room Types ----------
function RoomTypesSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { list, create, update, remove } = useEntityCrud<any>({
    table: "room_types", queryKey: ["admin", "room_types", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Room type",
  });

  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "code", label: "Code", type: "text" as const },
    { name: "description", label: "Description", type: "textarea" as const },
    { name: "max_occupancy", label: "Max occupancy", type: "number" as const, min: 1 },
    { name: "base_rate", label: "Base rate", type: "number" as const, min: 0 },
    { name: "is_public", label: "Public", type: "switch" as const },
  ];

  const handleSubmit = async (values: Record<string, unknown>) => {
    const payload = { ...values, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };

  return (
    <>
      <CrudTable
        title="Room Types" icon={<DoorOpen className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New room type"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Code", cell: (r) => r.code ?? "—", printValue: (r) => r.code },
          { label: "Max occ.", cell: (r) => r.max_occupancy, num: true, printValue: (r) => r.max_occupancy },
          { label: "Base rate", cell: (r) => Number(r.base_rate ?? 0).toFixed(2), num: true, printValue: (r) => Number(r.base_rate ?? 0).toFixed(2) },
          { label: "Public", cell: (r) => r.is_public ? "Yes" : "No", printValue: (r) => r.is_public ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit room type" : "New room type"} fields={fields} initial={editing ?? { is_public: true, max_occupancy: 2, base_rate: 100 }} onSubmit={handleSubmit} submitting={create.isPending || update.isPending} />
    </>
  );
}

// ---------- Rooms ----------
function RoomsSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { list: types } = useEntityCrud<any>({
    table: "room_types", queryKey: ["admin", "room_types", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" },
  });
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "rooms", queryKey: ["admin", "rooms", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "number" }, label: "Room",
  });

  const typeMap = new Map((types.data ?? []).map((t) => [t.id, t.name]));

  const fields = [
    { name: "number", label: "Room number", type: "text" as const, required: true },
    { name: "floor", label: "Floor", type: "text" as const },
    { name: "room_type_id", label: "Room type", type: "select" as const, required: true, options: (types.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { name: "status", label: "Status", type: "select" as const, options: ["available","occupied","dirty","clean","inspected","out_of_order"].map((s) => ({ value: s, label: s })) },
  ];

  const handleSubmit = async (values: Record<string, unknown>) => {
    const payload = { ...values, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };

  return (
    <>
      <CrudTable
        title="Rooms" icon={<BedDouble className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New room"
        columns={[
          { label: "Number", cell: (r) => <span className="font-mono">{r.number}</span>, searchValue: (r) => r.number, printValue: (r) => r.number },
          { label: "Floor", cell: (r) => r.floor ?? "—", printValue: (r) => r.floor },
          { label: "Type", cell: (r) => typeMap.get(r.room_type_id) ?? "—", searchValue: (r) => typeMap.get(r.room_type_id) ?? "", printValue: (r) => typeMap.get(r.room_type_id) },
          { label: "Status", cell: (r) => <Badge variant="outline">{r.status}</Badge>, printValue: (r) => r.status },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit room" : "New room"} fields={fields} initial={editing ?? { status: "available" }} onSubmit={handleSubmit} submitting={create.isPending || update.isPending} />
    </>
  );
}

// ---------- Rate Plans ----------
function RatePlansSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { list: types } = useEntityCrud<any>({
    table: "room_types", queryKey: ["admin", "room_types", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" },
  });
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "rate_plans", queryKey: ["admin", "rate_plans", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "start_date", ascending: false }, label: "Rate plan",
  });

  const typeMap = new Map((types.data ?? []).map((t) => [t.id, t.name]));

  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "room_type_id", label: "Room type", type: "select" as const, required: true, options: (types.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { name: "rate", label: "Rate", type: "number" as const, required: true, min: 0 },
    { name: "start_date", label: "Start date", type: "date" as const, required: true },
    { name: "end_date", label: "End date", type: "date" as const, required: true },
    { name: "min_los", label: "Min length of stay", type: "number" as const, min: 1 },
    { name: "max_los", label: "Max length of stay", type: "number" as const, min: 1 },
    { name: "is_public", label: "Public", type: "switch" as const },
  ];

  const handleSubmit = async (values: Record<string, unknown>) => {
    const payload = { ...values, property_id: propertyId };
    if (editing) await update.mutateAsync({ id: editing.id, values: payload });
    else await create.mutateAsync(payload);
    setOpen(false); setEditing(null);
  };

  return (
    <>
      <CrudTable
        title="Rate Plans" icon={<Tag className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New rate plan"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Room type", cell: (r) => typeMap.get(r.room_type_id) ?? "—", printValue: (r) => typeMap.get(r.room_type_id) },
          { label: "Rate", cell: (r) => Number(r.rate).toFixed(2), num: true, printValue: (r) => Number(r.rate).toFixed(2) },
          { label: "Start", cell: (r) => r.start_date, printValue: (r) => r.start_date },
          { label: "End", cell: (r) => r.end_date, printValue: (r) => r.end_date },
          { label: "Public", cell: (r) => r.is_public ? "Yes" : "No", printValue: (r) => r.is_public ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit rate plan" : "New rate plan"} fields={fields} initial={editing ?? { is_public: true, rate: 100 }} onSubmit={handleSubmit} submitting={create.isPending || update.isPending} />
    </>
  );
}
