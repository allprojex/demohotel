import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Inbound Booking.com webhook.
// Booking.com signs each POST with an HMAC-SHA256 header over the raw body.
// On a valid signature we (1) enqueue the reservation change, (2) trigger an
// immediate ARI push so availability/rates reflect the new state (no cron wait).
//
// Body shape (mock — mirrors the shape used by the simulated adapter):
//   {
//     "hotel_id": "1234567",
//     "event": "reservation.new" | "reservation.modified" | "reservation.cancelled",
//     "reservation": {
//       "external_ref": "BDC-XYZ",
//       "external_room_code": "BDC-DBL-01",
//       "first_name": "...", "last_name": "...", "email": "...", "phone": "...",
//       "check_in": "YYYY-MM-DD", "check_out": "YYYY-MM-DD",
//       "adults": 2, "children": 0, "total": 240
//     }
//   }

const payloadSchema = z.object({
  hotel_id: z.string().min(1),
  event: z.enum(["reservation.new", "reservation.modified", "reservation.cancelled"]),
  reservation: z.object({
    external_ref: z.string().min(1),
    external_room_code: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    check_in: z.string(),
    check_out: z.string(),
    adults: z.number().int().min(1).default(1),
    children: z.number().int().min(0).default(0),
    total: z.number().nonnegative().default(0),
  }),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-BDC-Signature",
} as const;

export const Route = createFileRoute("/api/public/hooks/booking-com")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const secret = process.env.BOOKING_COM_WEBHOOK_SECRET;
        if (!secret) {
          return Response.json({ error: "Webhook not configured" }, { status: 500, headers: CORS });
        }

        const signatureHeader = request.headers.get("x-bdc-signature") ?? "";
        const rawBody = await request.text();

        const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
        const sigBuf = Buffer.from(signatureHeader, "utf8");
        const expBuf = Buffer.from(expected, "utf8");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return Response.json({ error: "Invalid signature" }, { status: 401, headers: CORS });
        }

        let json: unknown;
        try { json = JSON.parse(rawBody); } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
        }
        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400, headers: CORS });
        }
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find the matching channel by external_hotel_id
        const { data: channel, error: chErr } = await supabaseAdmin
          .from("channels")
          .select("id, property_id, is_active")
          .eq("type", "booking_com")
          .eq("external_hotel_id", body.hotel_id)
          .maybeSingle();
        if (chErr || !channel) {
          return Response.json({ error: "Unknown hotel_id" }, { status: 404, headers: CORS });
        }
        if (!channel.is_active) {
          return Response.json({ error: "Channel inactive" }, { status: 409, headers: CORS });
        }

        const t0 = Date.now();
        let httpStatus = 200;
        let responseBody: Record<string, unknown> = { ok: true };

        try {
          if (body.event === "reservation.cancelled") {
            // Cancel any reservation matching this external_ref
            const { error: cancelErr } = await supabaseAdmin
              .from("reservations")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("property_id", channel.property_id)
              .eq("external_ref", body.reservation.external_ref);
            if (cancelErr) throw cancelErr;
            responseBody = { ok: true, action: "cancelled" };
          } else {
            // new / modified: upsert into inbound queue for staff to import
            const { error: qErr } = await supabaseAdmin
              .from("channel_reservations_queue")
              .upsert(
                {
                  channel_id: channel.id,
                  property_id: channel.property_id,
                  external_ref: body.reservation.external_ref,
                  status: "pending",
                  payload: body.reservation as never,
                },
                { onConflict: "channel_id,external_ref" },
              );
            if (qErr) throw qErr;
            responseBody = { ok: true, action: body.event === "reservation.new" ? "queued" : "queued_modification" };
          }

          // Immediate ARI push (simulated) — refresh outbound availability/rates now.
          const pushMs = 120 + Math.floor(Math.random() * 400);
          await supabaseAdmin.from("channel_sync_logs").insert({
            channel_id: channel.id,
            property_id: channel.property_id,
            direction: "push_ari",
            status: "success",
            duration_ms: pushMs,
            message: `Immediate ARI push triggered by ${body.event}`,
            payload: { triggered_by: "webhook", external_ref: body.reservation.external_ref },
          });

          // Log the inbound webhook itself
          await supabaseAdmin.from("channel_sync_logs").insert({
            channel_id: channel.id,
            property_id: channel.property_id,
            direction: "webhook_inbound",
            status: "success",
            duration_ms: Date.now() - t0,
            message: `${body.event} · ${body.reservation.external_ref}`,
            payload: body as never,
          });

          await supabaseAdmin.from("channels").update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: "success",
            last_sync_error: null,
          }).eq("id", channel.id);
        } catch (e) {
          httpStatus = 500;
          const msg = e instanceof Error ? e.message : String(e);
          responseBody = { ok: false, error: msg };
          await supabaseAdmin.from("channel_sync_logs").insert({
            channel_id: channel.id,
            property_id: channel.property_id,
            direction: "webhook_inbound",
            status: "failed",
            duration_ms: Date.now() - t0,
            message: `${body.event} failed: ${msg}`,
            payload: body as never,
          });
          await supabaseAdmin.from("channels").update({
            last_sync_status: "failed",
            last_sync_error: msg,
          }).eq("id", channel.id);
        }

        return Response.json(responseBody, { status: httpStatus, headers: CORS });
      },
    },
  },
});
