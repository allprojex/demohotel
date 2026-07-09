import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ServerCog, ClipboardCheck, ExternalLink, Download, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin_/help")({
  head: () => ({ meta: [{ title: "Admin Help & Documentation" }] }),
  component: AdminHelp,
});

type Doc = {
  title: string;
  description: string;
  href: string;
  icon: typeof BookOpen;
  audience: string;
};

const DOCS: Doc[] = [
  {
    title: "User Training Guide",
    description: "Step-by-step walkthrough for staff — sign-in, front desk, housekeeping, POS, reports, notifications, security.",
    href: "/docs/user-training-guide.md",
    icon: BookOpen,
    audience: "All staff",
  },
  {
    title: "Offline Deployment Guide",
    description: "Command prompts for Kali, Ubuntu, and VS Code. Covers Node install, systemd unit, Nginx proxy, environment vars, and updates.",
    href: "/docs/offline-deployment-guide.md",
    icon: ServerCog,
    audience: "System administrators",
  },
  {
    title: "Deployment Checklist",
    description: "Verify Node version, database connectivity, migrations, background jobs, and smoke tests before declaring a release ready.",
    href: "/docs/deployment-checklist.md",
    icon: ClipboardCheck,
    audience: "Release managers",
  },
];

function AdminHelp() {
  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Help & Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Training guides, deployment references, and health tools for administrators.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {DOCS.map((d) => {
          const Icon = d.icon;
          return (
            <Card key={d.href} className="p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{d.title}</div>
                  <Badge variant="outline" className="text-[10px] mt-1">{d.audience}</Badge>
                  <p className="text-sm text-muted-foreground mt-2">{d.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-auto">
                <Button asChild size="sm" variant="outline">
                  <a href={d.href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" />View
                  </a>
                </Button>
                <Button asChild size="sm">
                  <a href={d.href} download>
                    <Download className="h-3 w-3 mr-1" />Download
                  </a>
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Live health probe</div>
            <p className="text-sm text-muted-foreground mt-1">
              Public endpoint that returns HTTP 200 when the runtime, environment and database are healthy.
              Use it with systemd/Nginx or the bundled <code className="text-xs bg-muted px-1 py-0.5 rounded">scripts/healthcheck.sh</code>.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Button asChild size="sm" variant="outline">
                <a href="/api/public/health" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />Open /api/public/health
                </a>
              </Button>
              <code className="text-xs bg-muted px-2 py-1 rounded">./scripts/healthcheck.sh https://your-host</code>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="font-semibold mb-2">Command-line helpers shipped with this build</div>
        <ul className="text-sm space-y-1.5">
          <li><code className="text-xs bg-muted px-1.5 py-0.5 rounded">scripts/offline-install.sh</code> — one-shot installer (Node, deps, .env template, systemd unit, health probe).</li>
          <li><code className="text-xs bg-muted px-1.5 py-0.5 rounded">scripts/healthcheck.sh</code> — probes <code>/api/public/health</code> and exits 0 / 1 / 2 for monitoring.</li>
        </ul>
      </Card>
    </div>
  );
}
