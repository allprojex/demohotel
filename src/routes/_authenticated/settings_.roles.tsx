import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useActiveProperty } from "@/hooks/use-active-property";
import { useUserRoles } from "@/hooks/use-user-roles";
import { ADMIN_ROLES } from "@/lib/admin/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, KeyRound, CheckCircle2, Ban, Undo2, ShieldCheck, Loader2, Copy, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import {
  inviteUser, setUserStatus, resetUserPassword, listManageableUsers,
  grantUserRole, revokeUserRole, type ManageableUser,
} from "@/lib/users.functions";

const ROLES = [
  "super_admin","hotel_owner","general_manager","front_desk","reservations",
  "cashier","accountant","housekeeping_supervisor","housekeeping",
];

export const Route = createFileRoute("/_authenticated/settings_/roles")({
  head: () => ({ meta: [{ title: "Roles & Permissions — Settings" }] }),
  component: RolesPage,
});

function RolesPage() {
  const propertyId = useActiveProperty();
  const rolesQ = useUserRoles();
  const isSuper = (rolesQ.data ?? []).some((r) => r.role === "super_admin");
  const isAdmin = isSuper || (rolesQ.data ?? []).some(
    (r) => ADMIN_ROLES.includes(r.role) && (r.property_id === null || r.property_id === propertyId),
  );

  if (rolesQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) return <AccessDenied />;
  if (!propertyId) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Select a property</h2>
        <p className="mt-1 text-sm text-muted-foreground">Roles are managed per property. Choose one from the top bar.</p>
      </div>
    );
  }

  return <RolesInner propertyId={propertyId} />;
}

function RolesInner({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listManageableUsers);
  const listQ = useQuery({
    queryKey: ["manageable-users", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["manageable-users", propertyId] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Roles & Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Invite users, approve accounts, assign roles, and reset passwords for this property.
          </p>
        </div>
        <InviteDialog propertyId={propertyId} onDone={invalidate} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Users</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading && (
                <TableRow><TableCell colSpan={4} className="py-10 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                </TableCell></TableRow>
              )}
              {listQ.data?.map((u) => (
                <UserRow key={u.id} user={u} propertyId={propertyId} onChange={invalidate} />
              ))}
              {listQ.data && listQ.data.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No users yet — invite the first one.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Self-signup is disabled. Invited users receive an email invitation and remain
        in <span className="font-medium">pending</span> status until an administrator approves them.
      </p>
    </div>
  );
}

function statusVariant(s: ManageableUser["status"]) {
  if (s === "active") return "default" as const;
  if (s === "pending") return "secondary" as const;
  return "destructive" as const;
}

function UserRow({ user, propertyId, onChange }: {
  user: ManageableUser; propertyId: string; onChange: () => void;
}) {
  const setStatus = useServerFn(setUserStatus);
  const reset = useServerFn(resetUserPassword);
  const grant = useServerFn(grantUserRole);
  const revoke = useServerFn(revokeUserRole);
  const [pending, setPending] = useState<string[]>([]);
  const heldRoles = new Set(user.roles.map((r) => r.role));

  const statusMut = useMutation({
    mutationFn: (status: "active" | "disabled") => setStatus({ data: { userId: user.id, status, propertyId } }),
    onSuccess: (_r, s) => { toast.success(s === "active" ? "User approved / activated" : "User deactivated"); onChange(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { userId: user.id, email: user.email ?? "", propertyId } }),
    onSuccess: (r: any) => {
      if (r?.actionLink) {
        navigator.clipboard?.writeText(r.actionLink).catch(() => {});
        toast.success("Password reset link copied to clipboard");
      } else {
        toast.success("Reset email sent");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grantMut = useMutation({
    mutationFn: async (roles: string[]) => {
      for (const role of roles) await grant({ data: { userId: user.id, role, propertyId } });
    },
    onSuccess: (_r, roles) => {
      toast.success(`Granted ${roles.length} role${roles.length === 1 ? "" : "s"}`);
      setPending([]);
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (roleId: string) => revoke({ data: { roleId, propertyId } }),
    onSuccess: () => { toast.success("Role removed"); onChange(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{user.full_name ?? "(no name)"}</div>
        <div className="text-xs text-muted-foreground">{user.email ?? "—"}</div>
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant(user.status)} className="capitalize">{user.status}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5 max-w-md">
          {user.roles.length === 0 && <span className="text-xs text-muted-foreground">no roles</span>}
          {user.roles.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs">
              <span className="capitalize">{r.role.replace(/_/g, " ")}</span>
              <span className="text-[10px] text-muted-foreground">{r.property_id ? "" : "· global"}</span>
              <button
                onClick={() => revokeMut.mutate(r.id)}
                disabled={revokeMut.isPending}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Revoke role"
              ><Trash2 className="h-3 w-3" /></button>
            </span>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add roles
                {pending.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{pending.length}</Badge>}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <div className="max-h-64 overflow-auto space-y-1">
                {ROLES.map((r) => {
                  const held = heldRoles.has(r);
                  const checked = pending.includes(r);
                  return (
                    <label key={r}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:bg-muted ${held ? "opacity-50 cursor-not-allowed" : ""}`}>
                      <Checkbox
                        checked={checked}
                        disabled={held}
                        onCheckedChange={(v) =>
                          setPending((p) => (v ? [...p, r] : p.filter((x) => x !== r)))
                        }
                      />
                      <span className="capitalize flex-1">{r.replace(/_/g, " ")}</span>
                      {held && <span className="text-[10px] text-muted-foreground">held</span>}
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between gap-1 border-t pt-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPending([])} disabled={pending.length === 0}>
                  Clear
                </Button>
                <Button size="sm" className="h-7 text-xs" disabled={pending.length === 0 || grantMut.isPending}
                  onClick={() => grantMut.mutate(pending)}>
                  {grantMut.isPending ? "Granting…" : `Grant ${pending.length || ""}`}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex gap-1">
          {user.status !== "active" && (
            <Button size="sm" variant="outline" onClick={() => statusMut.mutate("active")} disabled={statusMut.isPending}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {user.status === "pending" ? "Approve" : "Reactivate"}
            </Button>
          )}
          {user.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => statusMut.mutate("disabled")} disabled={statusMut.isPending}>
              <Ban className="h-3.5 w-3.5 mr-1" /> Deactivate
            </Button>
          )}
          {user.status === "disabled" && (
            <Button size="sm" variant="outline" onClick={() => statusMut.mutate("active")} disabled={statusMut.isPending}>
              <Undo2 className="h-3.5 w-3.5 mr-1" /> Reactivate
            </Button>
          )}
          <Button size="sm" variant="ghost" title="Reset password" onClick={() => resetMut.mutate()} disabled={resetMut.isPending || !user.email}>
            <KeyRound className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function InviteDialog({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<string[]>(["front_desk"]);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const invite = useServerFn(inviteUser);

  const mut = useMutation({
    mutationFn: () => invite({ data: { email, fullName, roles, propertyId } }),
    onSuccess: (res: any) => {
      toast.success(
        res.invited
          ? `Invitation sent to ${email} with ${roles.length} role${roles.length === 1 ? "" : "s"}`
          : `Granted ${roles.length} role${roles.length === 1 ? "" : "s"} to existing user`,
      );
      setEmail(""); setFullName(""); setRoles(["front_desk"]); setLastLink(null);
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Invite user</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Sends an email invitation and grants the selected role(s). The account is created
            in pending status and can be approved from the users table.
          </DialogDescription>
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
            {roles.length === 0 && <p className="text-xs text-destructive mt-1">Select at least one role.</p>}
          </div>
          {lastLink && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs flex items-center gap-2">
              <span className="truncate">{lastLink}</span>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(lastLink)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || roles.length === 0}>
            {mut.isPending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
