import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EslDeviceKind =
  | "qr_scanner" | "barcode_scanner" | "rfid_reader" | "nfc_reader"
  | "esl_gateway" | "label_printer" | "handheld_pda" | "kiosk_camera";
export type EslDeviceConnection = "usb" | "bluetooth" | "network" | "serial" | "webcam" | "cloud";
export type EslDeviceStatus = "online" | "offline" | "error" | "paired";

type JsonLike = string | number | boolean | null | JsonLike[] | { [k: string]: JsonLike };

export type EslDeviceRow = {
  id: string;
  property_id: string;
  name: string;
  kind: EslDeviceKind;
  connection: EslDeviceConnection;
  address: string | null;
  vendor: string | null;
  model: string | null;
  status: EslDeviceStatus;
  last_seen_at: string | null;
  notes: string | null;
  metadata: JsonLike;
  created_at: string;
  updated_at: string;
};

export type EslPairingCodeRow = {
  id: string;
  property_id: string;
  code: string;
  suggested_name: string | null;
  kind: EslDeviceKind;
  connection: EslDeviceConnection;
  expires_at: string;
  consumed_at: string | null;
  device_id: string | null;
  created_at: string;
};

function plain<T>(rows: unknown[]): T[] { return JSON.parse(JSON.stringify(rows)) as T[]; }

function randomCode(): string {
  // 8-char base32-ish (no ambiguous 0/O/I/1)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const listEslDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId: string }) => input)
  .handler(async ({ data, context }): Promise<EslDeviceRow[]> => {
    const { data: rows, error } = await (context.supabase.from("esl_devices") as any)
      .select("*").eq("property_id", data.propertyId).order("kind").order("name");
    if (error) throw new Error(error.message);
    return plain<EslDeviceRow>(rows ?? []);
  });

export const upsertEslDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string; propertyId: string; name: string;
    kind: EslDeviceKind; connection: EslDeviceConnection;
    address?: string | null; vendor?: string | null; model?: string | null;
    notes?: string | null; status?: EslDeviceStatus;
  }) => input)
  .handler(async ({ data, context }) => {
    const row = {
      property_id: data.propertyId, name: data.name,
      kind: data.kind, connection: data.connection,
      address: data.address ?? null, vendor: data.vendor ?? null, model: data.model ?? null,
      notes: data.notes ?? null, status: data.status ?? "offline",
    };
    if (data.id) {
      const { error } = await (context.supabase.from("esl_devices") as any).update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await (context.supabase.from("esl_devices") as any)
      .insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id };
  });

/**
 * Soft-delete: snapshot to recycle_bin then remove the row.
 * Restoring re-inserts the same id via upsert.
 */
export const deleteEslDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row, error: selErr } = await (context.supabase.from("esl_devices") as any)
      .select("*").eq("id", data.id).single();
    if (selErr) throw new Error(selErr.message);

    const { error: binErr } = await (context.supabase.from("recycle_bin") as any).insert({
      source_table: "esl_devices",
      source_id: row.id,
      snapshot: row,
      property_id: row.property_id,
      label: `${row.kind} · ${row.name}`,
      deleted_by: context.userId,
    });
    if (binErr) throw new Error(binErr.message);

    const { error } = await (context.supabase.from("esl_devices") as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await context.supabase.rpc("audit_capture", {
      _property_id: row.property_id, _entity_type: "esl_devices", _entity_id: row.id,
      _action: "delete", _before: row as never, _after: null as never,
      _memo: "Moved to recycle bin", _ip: null, _user_agent: null,
      _os: null, _browser: null, _fingerprint: null, _session_id: null,
      _success: true, _remarks: null,
    } as never);

    return { ok: true };
  });

export const markEslDeviceSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status?: EslDeviceStatus }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("esl_devices") as any)
      .update({ status: data.status ?? "online", last_seen_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────── QR pairing ───────────

export const createEslPairingCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    propertyId: string;
    kind: EslDeviceKind;
    connection: EslDeviceConnection;
    suggestedName?: string | null;
    ttlMinutes?: number;
  }) => input)
  .handler(async ({ data, context }): Promise<EslPairingCodeRow> => {
    const code = randomCode();
    const expiresAt = new Date(Date.now() + (data.ttlMinutes ?? 15) * 60_000).toISOString();
    const { data: ins, error } = await (context.supabase.from("esl_pairing_codes") as any)
      .insert({
        property_id: data.propertyId,
        code,
        kind: data.kind,
        connection: data.connection,
        suggested_name: data.suggestedName ?? null,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.rpc("audit_capture", {
      _property_id: data.propertyId, _entity_type: "esl_pairing_codes", _entity_id: ins.id,
      _action: "create", _before: null as never, _after: ins as never,
      _memo: `Pairing code ${code} · ${data.kind}`, _ip: null, _user_agent: null,
      _os: null, _browser: null, _fingerprint: null, _session_id: null,
      _success: true, _remarks: null,
    } as never);

    return plain<EslPairingCodeRow>([ins])[0];
  });

export const lookupEslPairingCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => input)
  .handler(async ({ data, context }): Promise<EslPairingCodeRow | null> => {
    const { data: row, error } = await (context.supabase.from("esl_pairing_codes") as any)
      .select("*").eq("code", data.code).maybeSingle();
    if (error) throw new Error(error.message);
    return row ? plain<EslPairingCodeRow>([row])[0] : null;
  });

export const redeemEslPairingCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    code: string; name?: string | null;
    address?: string | null; vendor?: string | null; model?: string | null;
  }) => input)
  .handler(async ({ data, context }): Promise<{ deviceId: string }> => {
    const { data: deviceId, error } = await context.supabase.rpc("esl_redeem_pairing_code", {
      _code: data.code,
      _name: data.name ?? "",
      _address: data.address ?? "",
      _vendor: data.vendor ?? "",
      _model: data.model ?? "",
    } as never);
    if (error) throw new Error(error.message);

    // Fetch resulting device for audit context
    const { data: dev } = await (context.supabase.from("esl_devices") as any)
      .select("*").eq("id", deviceId as unknown as string).maybeSingle();

    await context.supabase.rpc("audit_capture", {
      _property_id: dev?.property_id ?? null,
      _entity_type: "esl_devices", _entity_id: deviceId as unknown as string,
      _action: "create", _before: null as never, _after: dev as never,
      _memo: `Paired via QR code ${data.code}`, _ip: null, _user_agent: null,
      _os: null, _browser: null, _fingerprint: null, _session_id: null,
      _success: true, _remarks: null,
    } as never);

    return { deviceId: deviceId as unknown as string };
  });
