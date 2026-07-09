import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";

interface Props {
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: string;
  /** If provided, user must type this string to enable deletion (high-risk entities). */
  requireTyped?: string;
  triggerLabel?: React.ReactNode;
  triggerVariant?: "ghost" | "destructive" | "outline";
  size?: "sm" | "default" | "icon";
  disabled?: boolean;
}

export function DeleteConfirm({
  onConfirm, title = "Delete this record?", description,
  requireTyped, triggerLabel, triggerVariant = "ghost", size = "sm", disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const canConfirm = requireTyped ? typed === requireTyped : true;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTyped(""); }}>
      <AlertDialogTrigger asChild>
        <Button variant={triggerVariant} size={size} disabled={disabled} className={triggerVariant === "ghost" ? "text-destructive hover:text-destructive" : ""}>
          {triggerLabel ?? <><Trash2 className="h-3.5 w-3.5" />{size !== "icon" && <span className="ml-1">Delete</span>}</>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? "This action cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {requireTyped && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Type <span className="font-mono font-semibold">{requireTyped}</span> to confirm.</div>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireTyped} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async (e) => { e.preventDefault(); await onConfirm(); setOpen(false); setTyped(""); }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
