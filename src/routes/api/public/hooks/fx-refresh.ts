import { createFileRoute } from "@tanstack/react-router";
import { runFxRefresh } from "@/lib/fx.functions";

// pg_cron calls this hourly with header `x-cron-secret: <CRON_SECRET>`.
export const Route = createFileRoute("/api/public/hooks/fx-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) return new Response("Server misconfigured", { status: 500 });
        const provided =
          request.headers.get("x-cron-secret") ??
          (request.headers.get("authorization")?.startsWith("Bearer ")
            ? request.headers.get("authorization")!.slice(7)
            : null);
        if (!provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await runFxRefresh();
        return Response.json(result);
      },
    },
  },
});
