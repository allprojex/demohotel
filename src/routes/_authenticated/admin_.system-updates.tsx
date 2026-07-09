import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Package, ExternalLink, ShieldCheck, Info } from "lucide-react";
import { APP_VERSION, APP_BUILD_DATE, APP_CHANNEL, RELEASE_NOTES } from "@/lib/version";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin_/system-updates")({
  head: () => ({ meta: [{ title: "System Updates" }] }),
  component: SystemUpdates,
});

function SystemUpdates() {
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">System Update Center</h1>
        <p className="text-sm text-muted-foreground">Version information and release history.</p>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-3"><Package className="h-6 w-6 text-primary" /></div>
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Current version</div>
              <div className="text-2xl font-semibold">v{APP_VERSION}</div>
              <div className="text-xs text-muted-foreground">Built {APP_BUILD_DATE} • {APP_CHANNEL} channel</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => toast.success("You are on the latest release.")}><RefreshCw className="h-4 w-4 mr-1" />Check for updates</Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 border-amber-500/40 bg-amber-500/5">
        <div className="flex gap-3">
          <ShieldCheck className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Backup reminder</div>
            <p className="text-muted-foreground mt-1">
              Before any major system change, export your data via <span className="font-medium">Cloud → Advanced settings → Export data</span>.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 border-primary/30 bg-primary/5">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Managed updates</div>
            <p className="text-muted-foreground mt-1">
              This application is deployed as a managed service. New versions ship automatically on release. Rollback is available on request.
            </p>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-2">Release notes</h2>
        <div className="space-y-3">
          {RELEASE_NOTES.map((r) => (
            <Card key={r.version} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge>v{r.version}</Badge>
                  <span className="text-xs text-muted-foreground">{r.date}</span>
                </div>
              </div>
              <ul className="mt-2 space-y-1 text-sm list-disc pl-5">
                {r.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Card>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2 flex items-center gap-2"><ExternalLink className="h-4 w-4" />Deployment</div>
        <a href="https://infinity-hotel-pms.lovable.app" target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">infinity-hotel-pms.lovable.app</a>
      </Card>
    </div>
  );
}
