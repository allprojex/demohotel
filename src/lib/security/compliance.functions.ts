import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ComplianceRow = {
  id: string;
  source: "security" | "audit";
  when: string;
  event_type: string;
  severity: string | null;
  user_id: string | null;
  property_id: string | null;
  ip: string | null;
  action: string | null;
  entity: string | null;
  entity_id: string | null;
  metadata: string | null;
};

export type ComplianceFilters = {
  from?: string;
  to?: string;
  source?: "security" | "audit" | "both";
  severity?: string | null;
  search?: string | null;
  propertyId?: string | null;
  limit?: number;
};

function parseInput(input: Partial<ComplianceFilters>): ComplianceFilters {
  return {
    from: input.from,
    to: input.to,
    source: input.source ?? "both",
    severity: input.severity ?? null,
    search: input.search ?? null,
    propertyId: input.propertyId ?? null,
    limit: Math.min(input.limit ?? 500, 5000),
  };
}

async function fetchRows(supabase: any, f: ComplianceFilters): Promise<ComplianceRow[]> {
  const rows: ComplianceRow[] = [];
  const from = f.from ? new Date(f.from).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
  const to = f.to ? new Date(f.to).toISOString() : new Date().toISOString();

  if (f.source === "security" || f.source === "both") {
    let q = supabase.from("security_events").select("*")
      .gte("created_at", from).lte("created_at", to)
      .order("created_at", { ascending: false }).limit(f.limit ?? 500);
    if (f.severity) q = q.eq("severity", f.severity);
    if (f.propertyId) q = q.eq("property_id", f.propertyId);
    if (f.search) q = q.ilike("event_type", `%${f.search}%`);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        id: r.id, source: "security", when: r.created_at,
        event_type: r.event_type, severity: r.severity,
        user_id: r.user_id, property_id: r.property_id,
        ip: (r.ip as string | null) ?? null, action: null, entity: null, entity_id: null,
        metadata: r.metadata ? JSON.stringify(r.metadata) : null,
      });
    }
  }

  if (f.source === "audit" || f.source === "both") {
    let q = supabase.from("audit_logs").select("*")
      .gte("created_at", from).lte("created_at", to)
      .order("created_at", { ascending: false }).limit(f.limit ?? 500);
    if (f.propertyId) q = q.eq("property_id", f.propertyId);
    if (f.search) q = q.ilike("action", `%${f.search}%`);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        id: r.id, source: "audit", when: r.created_at,
        event_type: r.action, severity: null,
        user_id: r.user_id, property_id: r.property_id,
        ip: null, action: r.action, entity: r.entity, entity_id: r.entity_id,
        metadata: r.meta ? JSON.stringify(r.meta) : null,
      });
    }
  }

  rows.sort((a, b) => (a.when < b.when ? 1 : -1));
  return rows.slice(0, f.limit ?? 500);
}

export const queryComplianceLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<ComplianceFilters>) => parseInput(input))
  .handler(async ({ data, context }): Promise<ComplianceRow[]> => {
    const rows = await fetchRows(context.supabase, data);
    return JSON.parse(JSON.stringify(rows));
  });

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const exportComplianceCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<ComplianceFilters>) => parseInput(input))
  .handler(async ({ data, context }) => {
    const rows = await fetchRows(context.supabase, data);
    const header = ["timestamp", "source", "event_type", "severity", "user_id", "property_id", "ip", "entity", "entity_id", "metadata"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.when, r.source, r.event_type, r.severity ?? "",
        r.user_id ?? "", r.property_id ?? "", r.ip ?? "",
        r.entity ?? "", r.entity_id ?? "",
        r.metadata ?? "",
      ].map(csvEscape).join(","));
    }
    return { csv: lines.join("\n"), count: rows.length };
  });

export const exportCompliancePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<ComplianceFilters>) => parseInput(input))
  .handler(async ({ data, context }): Promise<{ base64: string; count: number }> => {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const rows = await fetchRows(context.supabase, data);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageW = 792, pageH = 612; // letter landscape
    const margin = 36;
    const rowH = 12;
    const cols = [
      { key: "when" as const, label: "Timestamp", w: 130 },
      { key: "source" as const, label: "Source", w: 60 },
      { key: "event_type" as const, label: "Event / Action", w: 180 },
      { key: "severity" as const, label: "Severity", w: 60 },
      { key: "user_id" as const, label: "User", w: 90 },
      { key: "ip" as const, label: "IP", w: 90 },
      { key: "entity" as const, label: "Entity", w: 100 },
    ];

    let page = pdf.addPage([pageW, pageH]);
    let y = pageH - margin;

    function drawHeader(pageNum: number) {
      page.drawText("Compliance Audit Report", { x: margin, y, font: bold, size: 14, color: rgb(0, 0, 0) });
      y -= 16;
      const range = `${data.from ?? "last 30d"} → ${data.to ?? "now"}   ·   Source: ${data.source}   ·   Rows: ${rows.length}   ·   Generated: ${new Date().toISOString()}`;
      page.drawText(range, { x: margin, y, font, size: 8, color: rgb(0.3, 0.3, 0.3) });
      y -= 14;
      let x = margin;
      for (const c of cols) {
        page.drawText(c.label, { x, y, font: bold, size: 8 });
        x += c.w;
      }
      y -= 4;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= rowH;
      page.drawText(`Page ${pageNum}`, { x: pageW - margin - 40, y: 20, font, size: 7, color: rgb(0.5, 0.5, 0.5) });
    }

    let pageNum = 1;
    drawHeader(pageNum);

    for (const r of rows) {
      if (y < margin + rowH) {
        pageNum += 1;
        page = pdf.addPage([pageW, pageH]);
        y = pageH - margin;
        drawHeader(pageNum);
      }
      let x = margin;
      for (const c of cols) {
        const raw = (r as any)[c.key];
        let text = raw == null ? "" : String(raw);
        if (c.key === "when") text = new Date(text).toISOString().replace("T", " ").slice(0, 19);
        if (c.key === "user_id" && text) text = text.slice(0, 8);
        const maxChars = Math.floor(c.w / 4.5);
        if (text.length > maxChars) text = text.slice(0, maxChars - 1) + "…";
        page.drawText(text, { x, y, font, size: 7, color: rgb(0.1, 0.1, 0.1) });
        x += c.w;
      }
      y -= rowH;
    }

    const bytes = await pdf.save();
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    // btoa is available in the Worker runtime
    const base64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bytes).toString("base64");
    return { base64, count: rows.length };
  });
