import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function AccessDenied({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center text-center gap-3">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <div>
          <div className="text-lg font-medium">Access restricted</div>
          <p className="text-sm text-muted-foreground max-w-md mt-1">
            {message ?? "You don't have permission to view this page for the selected property. Contact an administrator to request access."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
