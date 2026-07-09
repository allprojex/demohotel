import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProperty } from "@/hooks/use-active-property";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Star } from "lucide-react";

export const Route = createFileRoute("/_authenticated/guests/")({
  head: () => ({ meta: [{ title: "Guests" }] }),
  component: GuestsPage,
});

function GuestsPage() {
  const propertyId = useActiveProperty();
  const [q, setQ] = useState("");
  const guests = useQuery({
    queryKey: ["guests", propertyId], enabled: !!propertyId,
    queryFn: async () => (await supabase.from("guests").select("*").eq("property_id", propertyId!).order("last_name").limit(500)).data,
  });
  const filtered = (guests.data ?? []).filter((g: any) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return `${g.first_name} ${g.last_name}`.toLowerCase().includes(s) || (g.email ?? "").toLowerCase().includes(s) || (g.phone ?? "").includes(s);
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Guests</h1>
        <p className="text-sm text-muted-foreground">Guest directory and history.</p>
      </div>
      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name, email, phone…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Nationality</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((g: any) => (
              <TableRow key={g.id} className="cursor-pointer hover:bg-muted/50" onClick={() => (window.location.href = `/guests/${g.id}`)}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">{g.first_name} {g.last_name} {g.vip && <Star className="h-3 w-3 fill-warning text-warning" />}</div>
                </TableCell>
                <TableCell>{g.email ?? "—"}</TableCell>
                <TableCell>{g.phone ?? "—"}</TableCell>
                <TableCell>{g.nationality ?? "—"}</TableCell>
                <TableCell><Link to="/guests/$id" params={{ id: g.id }} className="text-primary text-xs">View →</Link></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No guests yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
