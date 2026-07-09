import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { NATIONALITIES, REGION_ORDER, type Nationality } from "@/data/nationalities";

export function NationalitySelect({
  value, onChange, placeholder = "Select nationality",
}: { value?: string | null; onChange: (code: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const selected = NATIONALITIES.find((n) => n.code === value);
  const grouped: Record<string, Nationality[]> = {};
  for (const region of REGION_ORDER) grouped[region] = [];
  NATIONALITIES.forEach((n) => grouped[n.region].push(n));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected ? `${selected.name} (${selected.code})` : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No country found.</CommandEmpty>
            {Object.entries(grouped).map(([region, items]) =>
              items.length ? (
                <CommandGroup key={region} heading={region}>
                  {items.map((n) => (
                    <CommandItem
                      key={n.code}
                      value={`${n.name} ${n.code}`}
                      onSelect={() => { onChange(n.code); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === n.code ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1">{n.name}</span>
                      <span className="text-xs text-muted-foreground">{n.code}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
