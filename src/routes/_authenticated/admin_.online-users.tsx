import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Users, Activity, Wifi, WifiOff, Trash2 } from "lucide-react";
import { listOnlineUsers, purgeOnlineUsers } from "@/lib/sessions.functions";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin_/online-users")({
  head: () => ({ meta: [{ title: "Live Online Users" }] }),
  component: OnlineUsersPage,
});

function OnlineUsersPage() {
  const propertyId = useActiveProperty();
  const qc = useQueryClient();
  const list = useServerFn(listOnlineUsers);
  const purgeFn = useServerFn(purgeOnlineUsers);
  const [scope, setScope] = useState<"property" | "all">("property");

  const q = useQuery({
    queryKey: ["online-users", propertyId],
    enabled: !!propertyId,
    refetchInterval: 30_000,
    queryFn: () => list({ data: { propertyId: propertyId! } }),
  });

  const purge = useMutation({
    mutationFn: () => purgeFn({ data: { propertyId: propertyId!, scope } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["online-users"] });
      toast.success(`Purged ${res.purged} session${res.purged === 1 ? "" : "s"}.`);
    },
    onError: (e: any) => toast.error(e.message ?? "Purge failed."),
  });

  const c = q.data?.counts;
  const users = q.data?.users ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Live Online Users</h1>
          <p className="text-sm text-muted-foreground">Real-time (30 s polling) session activity.</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-1.5" disabled={!propertyId || users.length === 0}>
              <Trash2 className="h-3.5 w-3.5" />Purge sessions
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Purge live sessions?</AlertDialogTitle>
              <AlertDialogDescription>
                All affected users will be signed out on their next request. This does not delete accounts.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex gap-2 my-2">
              <Button
                type="button"
                variant={scope === "property" ? "default" : "outline"}
                size="sm"
                onClick={() => setScope("property")}
              >This property</Button>
              <Button
                type="button"
                variant={scope === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setScope("all")}
              >All properties (super admin)</Button>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => purge.mutate()} disabled={purge.isPending}>
                {purge.isPending ? "Purging…" : "Purge now"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Online" value={c?.online ?? 0} icon={<Wifi className="h-4 w-4 text-emerald-500" />} />
        <Stat label="Idle" value={c?.idle ?? 0} icon={<Activity className="h-4 w-4 text-amber-500" />} />
        <Stat label="Active sessions (24h)" value={c?.activeSessions ?? 0} icon={<Users className="h-4 w-4" />} />
        <Stat label="Total registered" value={c?.totalRegistered ?? 0} icon={<Users className="h-4 w-4" />} />
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>User</TableHead><TableHead>Status</TableHead>
            <TableHead>Last activity</TableHead><TableHead>OS</TableHead><TableHead>Browser</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell><div className="font-medium">{u.full_name ?? u.user_id.slice(0, 8)}</div></TableCell>
                <TableCell>
                  <Badge variant={u.status === "online" ? "default" : u.status === "idle" ? "secondary" : "outline"}>
                    {u.status === "offline" ? <WifiOff className="mr-1 h-3 w-3" /> : <Wifi className="mr-1 h-3 w-3" />}
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(u.last_seen_at), { addSuffix: true })}
                </TableCell>
                <TableCell className="text-xs">{u.os}</TableCell>
                <TableCell className="text-xs">{u.browser}</TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No active sessions.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>{icon}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}
