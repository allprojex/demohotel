import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserCog, UserPlus, Trash2, KeyRound, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { CrudTable } from "@/components/admin/crud-table";
import { DeleteConfirm } from "@/components/admin/delete-confirm";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteUser, setUserStatus, resetUserPassword } from "@/lib/users.functions";
import { toast } from "sonner";
import type { AppRole } from "@/hooks/use-user-roles";

interface Props { propertyId: string | null; }

const ALL_ROLES: AppRole[] = ["super_admin","hotel_owner","general_manager","accountant","front_desk","reservations","housekeeping_supervisor","housekeeping","cashier","guest"];

export function UsersModule({ propertyId }: Props) {
  return (
    <div className="space-y-4">
      <UserRolesSection propertyId={propertyId} />
      <ProfilesSection propertyId={propertyId} />
    </div>
  );
}

function UserRolesSection({ propertyId }: { propertyId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", role: "front_desk" as AppRole });
  const invite = useServerFn(inviteUser);

  const rolesQ = useQuery({
    queryKey: ["admin", "user_roles", propertyId],
    queryFn: async () => {
      let q: any = supabase.from("user_roles").select("id, user_id, role, property_id");
      if (propertyId) q = q.or(`property_id.eq.${propertyId},property_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const uids = Array.from(new Set(rows.map((r) => String(r.user_id))));
      let profiles: any[] = [];
      if (uids.length) {
        const { data: pr } = await supabase.from("profiles").select("id, full_name").in("id", uids);
        profiles = pr ?? [];
      }
      const pmap = new Map(profiles.map((p) => [p.id, p.full_name]));
      return rows.map((r) => ({ ...r, full_name: pmap.get(r.user_id) ?? String(r.user_id).slice(0, 8) })) as Array<{ id: string; user_id: string; role: AppRole; property_id: string | null; full_name: string }>;
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role revoked"); qc.invalidateQueries({ queryKey: ["admin", "user_roles", propertyId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!form.email || !form.fullName) throw new Error("Email and name required");
      if (form.role !== "super_admin" && !propertyId) throw new Error("Select a property first");
      await invite({ data: { email: form.email, fullName: form.fullName, role: form.role, propertyId: propertyId ?? "" } });
    },
    onSuccess: () => { toast.success("User invited"); setOpen(false); setForm({ email: "", fullName: "", role: "front_desk" }); qc.invalidateQueries({ queryKey: ["admin", "user_roles", propertyId] }); qc.invalidateQueries({ queryKey: ["admin", "profiles", propertyId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <CrudTable
        title="User Roles" icon={<UserCog className="h-4 w-4" />}
        rows={rolesQ.data} loading={rolesQ.isLoading} rowKey={(r) => r.id}
        onAdd={() => setOpen(true)} addLabel="Invite user"
        columns={[
          { label: "User", cell: (r) => <div className="font-medium">{r.full_name}</div>, searchValue: (r) => r.full_name, printValue: (r) => r.full_name },
          { label: "Role", cell: (r) => <Badge variant={r.role === "super_admin" ? "default" : "outline"}>{r.role}</Badge>, searchValue: (r) => r.role, printValue: (r) => r.role },
          { label: "Scope", cell: (r) => r.property_id ? <span className="text-xs">This property</span> : <Badge className="text-[9px]">GLOBAL</Badge>, printValue: (r) => r.property_id ? "property" : "global" },
        ]}
        rowActions={(r) => <DeleteConfirm title={`Revoke ${r.role} from ${r.full_name}?`} triggerLabel={<><Trash2 className="h-3.5 w-3.5" /><span className="ml-1">Revoke</span></>} onConfirm={() => remove.mutateAsync(r.id)} />}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite user</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ALL_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">Invited users start in <em>pending</em> status until approved below.</p>
            {!propertyId && form.role !== "super_admin" && <div className="text-xs text-destructive">Select an active property to invite non-global users.</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending}><UserPlus className="h-3.5 w-3.5 mr-1" />Invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfilesSection({ propertyId }: { propertyId: string | null }) {
  const qc = useQueryClient();
  const setStatus = useServerFn(setUserStatus);
  const resetPwd = useServerFn(resetUserPassword);

  const profilesQ = useQuery({
    queryKey: ["admin", "profiles", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      // Only surface profiles that have a role in this property or are global.
      const { data: roles } = await supabase.from("user_roles").select("user_id, role, property_id")
        .or(propertyId ? `property_id.eq.${propertyId},property_id.is.null` : "property_id.is.null");
      const uids = Array.from(new Set((roles ?? []).map((r: any) => String(r.user_id))));
      if (uids.length === 0) return [];
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", uids);
      // Get email via auth.admin listUsers proxy is out of scope; use profile fields.
      return (profiles ?? []) as any[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "profiles", propertyId] });

  const statusMut = useMutation({
    mutationFn: async (v: { userId: string; status: "active" | "disabled" | "pending" }) => {
      await setStatus({ data: { userId: v.userId, status: v.status, propertyId: propertyId! } });
    },
    onSuccess: () => { toast.success("User status updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: async (v: { userId: string; email: string }) => {
      const r: any = await resetPwd({ data: { userId: v.userId, email: v.email, propertyId: propertyId! } });
      return r;
    },
    onSuccess: (r: any) => {
      toast.success("Password reset link generated");
      if (r?.actionLink) navigator.clipboard.writeText(r.actionLink).catch(() => {});
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Users ({profilesQ.data?.length ?? 0})</CardTitle></CardHeader>
      <CardContent>
        <CrudTable
          title="Approve · Activate · Reset password"
          icon={<ShieldAlert className="h-4 w-4" />}
          rows={profilesQ.data} loading={profilesQ.isLoading} rowKey={(r) => r.id}
          columns={[
            { label: "Name", cell: (r) => <div className="font-medium">{r.full_name ?? "—"}</div>, searchValue: (r) => r.full_name ?? "", printValue: (r) => r.full_name ?? "" },
            { label: "Phone", cell: (r) => r.phone ?? "—", searchValue: (r) => r.phone ?? "", printValue: (r) => r.phone ?? "" },
            { label: "Status", cell: (r) => (
              <Badge variant={r.status === "active" ? "default" : r.status === "disabled" ? "destructive" : "secondary"}>
                {r.status ?? "active"}
              </Badge>
            ), searchValue: (r) => r.status ?? "active", printValue: (r) => r.status ?? "active" },
          ]}
          rowActions={(r) => {
            const email = (r as any).email ?? "";
            return (
              <div className="flex items-center gap-1">
                {r.status !== "active" && (
                  <Button size="sm" variant="ghost" onClick={() => statusMut.mutate({ userId: r.id, status: "active" })} title="Approve / Activate">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                )}
                {r.status !== "disabled" && (
                  <Button size="sm" variant="ghost" onClick={() => statusMut.mutate({ userId: r.id, status: "disabled" })} title="Deactivate">
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => {
                  const target = email || prompt("Enter user email for reset:") || "";
                  if (!target) return;
                  resetMut.mutate({ userId: r.id, email: target });
                }} title="Send password reset link">
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          }}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Approving sets the user to <em>active</em> and clears any authentication ban. Deactivating bans the user from signing in. Reset copies a recovery link to your clipboard.
        </p>
      </CardContent>
    </Card>
  );
}
