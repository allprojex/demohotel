import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { GHANA_REGIONS } from "@/data/ghana-regions";

export function GhanaRegionSelect({
  value, onChange,
}: { value?: string | null; onChange: (region: { code: string; name: string; capital: string }) => void }) {
  const [open, setOpen] = useState(false);
  const selected = GHANA_REGIONS.find((r) => r.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected ? `${selected.name} — ${selected.capital}` : "Select region"}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search region or capital…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No region found.</CommandEmpty>
            <CommandGroup heading="Regions of Ghana">
              {GHANA_REGIONS.map((r) => (
                <CommandItem
                  key={r.code}
                  value={`${r.name} ${r.capital}`}
                  onSelect={() => { onChange(r); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === r.code ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.capital}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
