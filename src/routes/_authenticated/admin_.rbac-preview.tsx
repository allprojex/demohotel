import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, ShieldAlert } from "lucide-react";
import { ROUTE_ROLE_MAP, isAllowed } from "@/lib/admin/route-permissions";
import type { AppRole } from "@/hooks/use-user-roles";

export const Route = createFileRoute("/_authenticated/admin_/rbac-preview")({
  head: () => ({
    meta: [
      { title: "RBAC Preview — Route Permissions" },
      { name: "description", content: "Preview which routes a role can access for a chosen property scope." },
    ],
  }),
  component: RbacPreviewPage,
});

const ALL_ROLES: AppRole[] = [
  "super_admin", "hotel_owner", "general_manager", "manager",
  "front_desk", "reservations", "guest_relations",
  "cashier", "restaurant_manager", "waiter", "kitchen",
  "accountant", "auditor",
  "housekeeping_supervisor", "housekeeping", "maintenance",
  "storekeeper", "security", "hr",
];

const SCOPE_GLOBAL = "__global__";
const SCOPE_NONE = "__none__";

function RbacPreviewPage() {
  const [role, setRole] = useState<AppRole>("front_desk");
  // "grant scope" = the property on which the role is granted
  const [grantScope, setGrantScope] = useState<string>(SCOPE_GLOBAL);
  // "active property" = the property the user is currently viewing
  const [activeProperty, setActiveProperty] = useState<string>(SCOPE_NONE);
  const [filter, setFilter] = useState("");

  const propsQ = useQuery({
    queryKey: ["rbac-preview-properties"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("properties").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(
    () => [{ role, property_id: grantScope === SCOPE_GLOBAL ? null : grantScope }],
    [role, grantScope],
  );
  const active = activeProperty === SCOPE_NONE ? null : activeProperty;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ROUTE_ROLE_MAP
      .filter((e) => !q || e.prefix.toLowerCase().includes(q))
      .map((e) => ({
        ...e,
        allowed: isAllowed(e.prefix, rows, active),
      }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix));
  }, [rows, active, filter]);

  const summary = useMemo(() => {
    const total = ROUTE_ROLE_MAP.length;
    const allow = ROUTE_ROLE_MAP.filter((e) => isAllowed(e.prefix, rows, active)).length;
    return { total, allow, deny: total - allow };
  }, [rows, active]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">RBAC Preview</h1>
        <p className="text-sm text-muted-foreground">
          Simulate the router's <code className="text-xs">isAllowed()</code> check for any role and property scope.
          This mirrors the guard used by <code className="text-xs">/_authenticated</code>.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Granted on</Label>
            <Select value={grantScope} onValueChange={setGrantScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SCOPE_GLOBAL}>Global (any property)</SelectItem>
                {(propsQ.data ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Active property</Label>
            <Select value={activeProperty} onValueChange={setActiveProperty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SCOPE_NONE}>None selected</SelectItem>
                {(propsQ.data ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Filter routes</Label>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="/admin, /pos…" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{summary.total} mapped routes</Badge>
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15">
            {summary.allow} allowed
          </Badge>
          <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-500/15">
            {summary.deny} blocked
          </Badge>
          {grantScope !== SCOPE_GLOBAL && active && grantScope !== active && role !== "super_admin" && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-3 w-3" />
              Cross-property: role is scoped to a different property than the active one.
            </span>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Route prefix</TableHead>
              <TableHead className="w-[100px]">Access</TableHead>
              <TableHead>Required roles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((e) => (
              <TableRow key={e.prefix}>
                <TableCell className="font-mono text-xs">{e.prefix}</TableCell>
                <TableCell>
                  {e.allowed ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm">
                      <Check className="h-4 w-4" /> Allowed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-sm">
                      <X className="h-4 w-4" /> Blocked
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {e.roles.map((r) => (
                      <Badge
                        key={r}
                        variant={r === role ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {r.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No routes match “{filter}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: Unmapped routes (not shown here) fall through to authenticated-only access.
        <code className="text-xs mx-1">super_admin</code> bypasses every check.
      </p>
    </div>
  );
}
