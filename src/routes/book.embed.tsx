import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/book/embed")({
  head: () => ({
    meta: [
      { title: "Book — widget" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Embed,
});

function Embed() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [propertyId, setPropertyId] = useState("");
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(tomorrow);
  const [guests, setGuests] = useState(2);

  const properties = useQuery({
    queryKey: ["public-properties"],
    queryFn: async () => {
      const { data } = await supabase.from("properties").select("id,name").eq("is_public", true).eq("active", true).order("name");
      return data ?? [];
    },
  });

  const canSearch = propertyId && checkOut > checkIn;

  return (
    <div className="min-h-screen bg-transparent p-4">
      <div className="rounded-lg border bg-card p-4 shadow-sm max-w-3xl mx-auto">
        <h2 className="font-display text-lg font-semibold mb-3">Reserve your stay</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label className="text-xs">Property</Label>
            <select className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Select…</option>
              {properties.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">Check-in</Label><Input type="date" value={checkIn} min={today} onChange={(e) => setCheckIn(e.target.value)} className="mt-1" /></div>
          <div><Label className="text-xs">Check-out</Label><Input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} className="mt-1" /></div>
          <div><Label className="text-xs">Guests</Label><Input type="number" min={1} max={10} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="mt-1" /></div>
        </div>
        <Button
          className="mt-3 w-full md:w-auto"
          disabled={!canSearch}
          onClick={() => {
            const url = `/book/results?propertyId=${propertyId}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`;
            if (window.top && window.top !== window.self) {
              window.open(url, "_blank");
            } else {
              navigate({ to: "/book/results", search: { propertyId, checkIn, checkOut, guests } });
            }
          }}
        >
          <Search className="h-4 w-4 mr-1" /> Search availability
        </Button>
      </div>
    </div>
  );
}
