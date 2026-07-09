import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Mock OTA adapter: simulates Booking.com sync with realistic latency + success rate.
async function simulateLatency(min = 200, max = 900) {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  await new Promise((r) => setTimeout(r, ms));
  return ms;
}

function randomOtaBooking(daysAhead = 30) {
  const firstNames = ["Alice", "Bruno", "Chen", "Diana", "Eero", "Fatima", "Gabriel", "Hana", "Ivan", "Julia"];
  const lastNames = ["Smith", "Kowalski", "Nakamura", "Silva", "Andersson", "El-Sayed", "Rossi", "Dubois"];
  const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
  const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
  const start = new Date(Date.now() + Math.floor(Math.random() * daysAhead) * 86400000);
  const nights = 1 + Math.floor(Math.random() * 4);
  const end = new Date(start.getTime() + nights * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    external_ref: `BDC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    first_name: fn,
    last_name: ln,
    email: `${fn}.${ln}${Math.floor(Math.random() * 999)}@example.com`.toLowerCase(),
    phone: `+1-555-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    check_in: iso(start),
    check_out: iso(end),
    adults: 1 + Math.floor(Math.random() * 3),
    children: Math.floor(Math.random() * 2),
    total: nights * (80 + Math.floor(Math.random() * 120)),
  };
}

export const runChannelSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { channelId: string; direction?: "push_ari" | "pull_reservations" | "both" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: channel, error: chErr } = await supabase
      .from("channels")
      .select("*")
      .eq("id", data.channelId)
      .maybeSingle();
    if (chErr || !channel) throw new Error("Channel not found or not permitted");

    const direction = data.direction ?? "both";
    const results: Array<{ direction: string; status: string; message: string }> = [];

    await supabase
      .from("channels")
      .update({ last_sync_status: "syncing", last_sync_error: null })
      .eq("id", channel.id);

    // Push ARI (availability / rates / inventory)
    if (direction === "push_ari" || direction === "both") {
      // Emit an in-progress marker so the UI sees the step start immediately.
      await supabase.from("channel_sync_logs").insert({
        channel_id: channel.id,
        property_id: channel.property_id,
        direction: "push_ari",
        status: "syncing",
        duration_ms: 0,
        message: "Pushing 30-day availability, rates & inventory…",
      });
      const ms = await simulateLatency();
      const ok = Math.random() > 0.05;
      const { data: mappings } = await supabase
        .from("channel_room_mappings")
        .select("id")
        .eq("channel_id", channel.id);
      const roomCount = mappings?.length ?? 0;
      await supabase.from("channel_sync_logs").insert({
        channel_id: channel.id,
        property_id: channel.property_id,
        direction: "push_ari",
        status: ok ? "success" : "failed",
        duration_ms: ms,
        message: ok
          ? `Pushed 30-day ARI for ${roomCount} mapped room types`
          : "Simulated push failure (network timeout)",
        payload: { room_types_pushed: roomCount, days: 30 },
      });
      results.push({ direction: "push_ari", status: ok ? "success" : "failed", message: "" });
    }

    // Pull reservations
    let queued = 0;
    if (direction === "pull_reservations" || direction === "both") {
      await supabase.from("channel_sync_logs").insert({
        channel_id: channel.id,
        property_id: channel.property_id,
        direction: "pull_reservations",
        status: "syncing",
        duration_ms: 0,
        message: "Fetching new reservations from OTA…",
      });
      const ms = await simulateLatency();
      const ok = Math.random() > 0.03;
      if (ok) {
        const count = Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const booking = randomOtaBooking();
          const { error: insErr } = await supabase.from("channel_reservations_queue").insert({
            channel_id: channel.id,
            property_id: channel.property_id,
            external_ref: booking.external_ref,
            payload: booking,
          });
          if (!insErr) queued++;
        }
      }
      await supabase.from("channel_sync_logs").insert({
        channel_id: channel.id,
        property_id: channel.property_id,
        direction: "pull_reservations",
        status: ok ? "success" : "failed",
        duration_ms: ms,
        message: ok ? `Pulled ${queued} new reservation(s)` : "Simulated pull failure",
        payload: { queued },
      });
      results.push({ direction: "pull_reservations", status: ok ? "success" : "failed", message: "" });
    }


    const anyFail = results.some((r) => r.status === "failed");
    await supabase
      .from("channels")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: anyFail ? "failed" : "success",
        last_sync_error: anyFail ? "Some operations failed — see logs" : null,
      })
      .eq("id", channel.id);

    return { ok: !anyFail, results, queued };
  });

export const importQueuedReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { queueId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("channel_import_queue", { _queue_id: data.queueId });
    if (error) throw new Error(error.message);
    return { reservationId: res };
  });

// Test Sync: read-only probe that hits the (mock) OTA to fetch current
// availability + rate snapshot for every mapped room type. Does NOT mutate
// reservations or push ARI — safe to run any time to verify credentials +
// mappings. Returns per-room-type results so the UI can render them.
export const testChannelSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { channelId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const started = Date.now();

    const { data: channel, error: chErr } = await supabase
      .from("channels")
      .select("id, property_id, name, external_hotel_id")
      .eq("id", data.channelId)
      .maybeSingle();
    if (chErr || !channel) throw new Error("Channel not found or not permitted");

    const { data: mappings } = await supabase
      .from("channel_room_mappings")
      .select("id, external_room_code, room_type_id, room_types(name, base_rate)")
      .eq("channel_id", channel.id);

    // Simulate network round-trip to the OTA
    const latency = await simulateLatency(180, 700);

    // 8% chance of a simulated auth / credential failure so the UI can show
    // the error path realistically.
    const credentialsOk = Math.random() > 0.08;
    if (!credentialsOk) {
      const msg = `Authentication failed for hotel_id=${channel.external_hotel_id ?? "—"}`;
      await supabase.from("channel_sync_logs").insert({
        channel_id: channel.id,
        property_id: channel.property_id,
        direction: "push_ari",
        status: "failed",
        duration_ms: Date.now() - started,
        message: `Test sync failed: ${msg}`,
        payload: { test: true } as never,
      });
      await supabase
        .from("channels")
        .update({ last_sync_status: "failed", last_sync_error: msg })
        .eq("id", channel.id);
      return { ok: false, error: msg, latency, rooms: [] as Array<{ mapping_id: string; room_type: string; external_code: string; available_today: number; rate_today: number; currency: string }> };
    }

    // Generate a live snapshot per mapping
    const rooms = (mappings ?? []).map((m) => {
      const rt = m.room_types as { name: string; base_rate: number } | null;
      const base = Number(rt?.base_rate ?? 100);
      const jitter = 1 + (Math.random() * 0.3 - 0.1); // ±10-20%
      const available = Math.floor(Math.random() * 8);
      return {
        mapping_id: m.id,
        room_type: rt?.name ?? "—",
        external_code: m.external_room_code,
        available_today: available,
        rate_today: Math.round(base * jitter * 100) / 100,
        currency: "GHS",
      };
    });

    await supabase.from("channel_sync_logs").insert({
      channel_id: channel.id,
      property_id: channel.property_id,
      direction: "pull_reservations",
      status: "success",
      duration_ms: Date.now() - started,
      message: `Test sync OK · fetched ${rooms.length} room type(s) in ${latency}ms`,
      payload: { test: true, rooms } as never,
    });
    await supabase
      .from("channels")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
      })
      .eq("id", channel.id);

    return { ok: true, latency, rooms };
  });
