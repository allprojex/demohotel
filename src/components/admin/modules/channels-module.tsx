import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Radio, RotateCcw } from "lucide-react";
import { CrudTable } from "@/components/admin/crud-table";
import { DeleteConfirm } from "@/components/admin/delete-confirm";
import { FieldForm } from "@/components/admin/field-form";
import { useEntityCrud } from "@/lib/admin/use-entity-crud";

interface Props { propertyId: string | null; }

export function ChannelsModule({ propertyId }: Props) {
  if (!propertyId) return <div className="text-sm text-muted-foreground p-6">Select a property to manage channels.</div>;
  return (
    <div className="space-y-4">
      <ChannelsSection propertyId={propertyId} />
      <ChannelQueueSection propertyId={propertyId} />
    </div>
  );
}

function ChannelsSection({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<any | null>(null);
  const { list, create, update, remove } = useEntityCrud<any>({
    table: "channels", queryKey: ["admin", "channels", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "name" }, label: "Channel",
  });
  const fields = [
    { name: "name", label: "Name", type: "text" as const, required: true },
    { name: "provider", label: "Provider", type: "select" as const, required: true, options: ["booking_com","expedia","airbnb","direct","other"].map((s) => ({ value: s, label: s })) },
    { name: "api_endpoint", label: "API endpoint", type: "text" as const },
    { name: "commission_rate", label: "Commission (%)", type: "number" as const, min: 0 },
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
      <CrudTable title="Channels" icon={<Radio className="h-4 w-4" />}
        rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
        onAdd={() => { setEditing(null); setOpen(true); }} addLabel="New channel"
        columns={[
          { label: "Name", cell: (r) => r.name, searchValue: (r) => r.name, printValue: (r) => r.name },
          { label: "Provider", cell: (r) => <Badge variant="outline">{r.provider}</Badge>, printValue: (r) => r.provider },
          { label: "Commission", cell: (r) => `${Number(r.commission_rate ?? 0).toFixed(2)}%`, num: true, printValue: (r) => `${Number(r.commission_rate ?? 0).toFixed(2)}%` },
          { label: "Active", cell: (r) => r.is_active ? "Yes" : "No", printValue: (r) => r.is_active ? "Yes" : "No" },
        ]}
        rowActions={(r) => <>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
          <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
        </>}
      />
      <FieldForm open={open} onOpenChange={setOpen} title={editing ? "Edit channel" : "New channel"} fields={fields} initial={editing ?? { is_active: true, provider: "booking_com", commission_rate: 15 }} onSubmit={submit} submitting={create.isPending || update.isPending} />
    </>
  );
}

function ChannelQueueSection({ propertyId }: { propertyId: string }) {
  const { list, update, remove } = useEntityCrud<any>({
    table: "channel_reservations_queue", queryKey: ["admin", "channel_queue", propertyId],
    filter: (q) => q.eq("property_id", propertyId), order: { column: "created_at", ascending: false }, label: "Queue item",
  });
  return (
    <CrudTable title="OTA Reservation Queue" icon={<RotateCcw className="h-4 w-4" />}
      rows={list.data} loading={list.isLoading} rowKey={(r) => r.id}
      columns={[
        { label: "External ref", cell: (r) => <span className="font-mono text-xs">{r.external_ref}</span>, searchValue: (r) => r.external_ref, printValue: (r) => r.external_ref },
        { label: "Status", cell: (r) => <Badge variant="outline">{r.status}</Badge>, printValue: (r) => r.status },
        { label: "Received", cell: (r) => r.created_at?.slice(0, 16).replace("T", " ") ?? "—", printValue: (r) => r.created_at?.slice(0, 16) },
      ]}
      rowActions={(r) => <>
        <Button size="sm" variant="ghost" title="Requeue" disabled={r.status === "pending"} onClick={() => update.mutate({ id: r.id, values: { status: "pending", processed_at: null } })}><RotateCcw className="h-3.5 w-3.5" /></Button>
        <DeleteConfirm onConfirm={() => remove.mutateAsync(r.id)} />
      </>}
    />
  );
}
