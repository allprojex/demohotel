import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { inviteUser } from "@/lib/users.functions";

const ROLES = [
  "super_admin","hotel_owner","general_manager","front_desk","reservations",
  "cashier","accountant","housekeeping_supervisor","housekeeping",
];

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users & Roles" }] }),
  component: UsersPage,
});

function UsersPage() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["user-roles", propertyId], enabled: !!propertyId,
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("*").or(`property_id.eq.${propertyId},property_id.is.null`);
      if (!roles) return [];
      const userIds = Array.from(new Set(roles.map((r) => r.user_id)));
      const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", userIds);
      return roles.map((r) => ({ ...r, profile: profiles?.find((p) => p.id === r.user_id) }));
    },
  });

  async function remove(id: string) {
    if (!confirm("Remove this role assignment?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed"); qc.invalidateQueries({ queryKey: ["user-roles", propertyId] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users & Roles</h1>
          <p className="text-sm text-muted-foreground">Invite staff and grant roles for this property.</p>
        </div>
        <InviteUserDialog propertyId={propertyId} onDone={() => qc.invalidateQueries({ queryKey: ["user-roles", propertyId] })} />
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Scope</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.data?.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell><div className="font-medium">{r.profile?.full_name ?? "(pending invite)"}</div><div className="text-xs text-muted-foreground font-mono">{r.user_id.slice(0, 8)}…</div></TableCell>
                <TableCell><Badge>{r.role.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell className="text-sm">{r.property_id ? "This property" : "Global"}</TableCell>
                <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No role assignments yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">Self-signup is disabled. Invited users receive an email to set their password before they can sign in.</p>
    </div>
  );
}

function InviteUserDialog({ propertyId, onDone }: { propertyId: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<string[]>(["front_desk"]);
  const [busy, setBusy] = useState(false);
  const invite = useServerFn(inviteUser);
  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  async function save() {
    if (!propertyId) { toast.error("Select a property first"); return; }
    if (roles.length === 0) { toast.error("Select at least one role"); return; }
    setBusy(true);
    try {
      const res = await invite({ data: { email, fullName, roles, propertyId } });
      toast.success(
        res.invited
          ? `Invitation sent to ${email} with ${roles.length} role${roles.length === 1 ? "" : "s"}`
          : `Granted ${roles.length} role${roles.length === 1 ? "" : "s"} to existing user`,
      );
      setOpen(false); setEmail(""); setFullName(""); setRoles(["front_desk"]);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Invite failed");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Invite user</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>Sends an email invitation and grants the selected role(s) for this property.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" /></div>
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" /></div>
          <div>
            <Label>Roles <span className="text-xs text-muted-foreground">(select one or more)</span></Label>
            <div className="mt-1 max-h-56 overflow-auto rounded-md border p-2 space-y-1">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer hover:bg-muted">
                  <Checkbox checked={roles.includes(r)} onCheckedChange={() => toggleRole(r)} />
                  <span className="capitalize flex-1">{r.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={busy || roles.length === 0}>{busy ? "Sending…" : "Send invite"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

