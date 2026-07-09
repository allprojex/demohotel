import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Heuristic scanner: pure logic, no external services.
// Runs entirely inside the Worker on the base64 payload.

const DANGEROUS_EXTENSIONS = new Set([
  "exe","dll","bat","cmd","com","msi","scr","pif","vbs","vbe","js","jse",
  "wsf","wsh","ps1","psm1","jar","apk","app","deb","rpm","sh","bash",
  "cpl","hta","reg","lnk","dmg","iso","img",
]);

const DANGEROUS_MIME_PREFIXES = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-mach-binary",
  "application/x-elf",
  "application/vnd.microsoft.portable-executable",
  "application/java-archive",
];

// Magic-byte signatures for executable/archive types
const MAGIC_SIGNATURES: Array<{ label: string; bytes: number[]; danger: boolean }> = [
  { label: "Windows PE / .EXE", bytes: [0x4d, 0x5a], danger: true },
  { label: "Linux ELF", bytes: [0x7f, 0x45, 0x4c, 0x46], danger: true },
  { label: "Mach-O (macOS)", bytes: [0xcf, 0xfa, 0xed, 0xfe], danger: true },
  { label: "Mach-O (macOS)", bytes: [0xce, 0xfa, 0xed, 0xfe], danger: true },
  { label: "Java class file", bytes: [0xca, 0xfe, 0xba, 0xbe], danger: true },
  { label: "Shell script", bytes: [0x23, 0x21], danger: true }, // #!
];

const SUSPICIOUS_TEXT_PATTERNS = [
  /<script[\s>]/i,
  /eval\s*\(/i,
  /base64_decode\s*\(/i,
  /powershell\s+-e/i,
  /cmd\.exe\s+\/c/i,
  /system\s*\(/i,
  /shell_exec/i,
  /exec\s*\(/i,
  /<\?php/i,
  /wscript\.shell/i,
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_TEXT_SNIFF = 512 * 1024; // 512 KB text-pattern scan

type Verdict = "clean" | "suspicious" | "malicious" | "error";

interface HeuristicResult {
  verdict: Verdict;
  hits: string[];
  reasons: string[];
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the type is BufferSource
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function runHeuristics(
  fileName: string,
  mime: string,
  bytes: Uint8Array,
): HeuristicResult {
  const hits: string[] = [];
  const reasons: string[] = [];
  let verdict: Verdict = "clean";

  if (bytes.byteLength === 0) {
    return { verdict: "suspicious", hits: ["empty_file"], reasons: ["File is empty."] };
  }
  if (bytes.byteLength > MAX_FILE_SIZE) {
    return { verdict: "suspicious", hits: ["oversize"], reasons: ["File exceeds 25 MB limit."] };
  }

  const ext = extOf(fileName);
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    hits.push(`ext_${ext}`);
    reasons.push(`Extension .${ext} is on the executable/script deny list.`);
    verdict = "malicious";
  }

  const mimeLower = (mime || "").toLowerCase();
  if (DANGEROUS_MIME_PREFIXES.some((p) => mimeLower.startsWith(p))) {
    hits.push(`mime_${mimeLower}`);
    reasons.push(`MIME type ${mimeLower} is an executable format.`);
    verdict = "malicious";
  }

  for (const sig of MAGIC_SIGNATURES) {
    if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) {
      hits.push(`magic_${sig.label}`);
      reasons.push(`File header matches ${sig.label}.`);
      if (sig.danger) verdict = "malicious";
      break;
    }
  }

  // Detect polyglot: extension says image but bytes say executable
  if (verdict === "malicious" && ["jpg","jpeg","png","gif","pdf","txt","csv"].includes(ext)) {
    hits.push("extension_mismatch");
    reasons.push(`Extension .${ext} does not match binary signature — possible disguised malware.`);
  }

  // Sniff a text window for scripting patterns
  const sniffLen = Math.min(bytes.length, MAX_TEXT_SNIFF);
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, sniffLen));
    for (const pat of SUSPICIOUS_TEXT_PATTERNS) {
      if (pat.test(text)) {
        hits.push(`pattern_${pat.source.slice(0, 20)}`);
        reasons.push(`Suspicious code pattern detected: ${pat.source}`);
        if (verdict === "clean") verdict = "suspicious";
      }
    }
  } catch {
    // ignore decoding errors
  }

  return { verdict, hits, reasons };
}

interface VtSummary {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  scan_date?: number | null;
  permalink?: string;
  found: boolean;
  error?: string;
}

async function queryVirusTotal(sha256: string): Promise<VtSummary | null> {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { "x-apikey": key, accept: "application/json" },
    });
    if (resp.status === 404) {
      return { malicious: 0, suspicious: 0, harmless: 0, undetected: 0, found: false };
    }
    if (!resp.ok) {
      return {
        malicious: 0, suspicious: 0, harmless: 0, undetected: 0, found: false,
        error: `VirusTotal HTTP ${resp.status}`,
      };
    }
    const body: any = await resp.json();
    const stats = body?.data?.attributes?.last_analysis_stats ?? {};
    return {
      malicious: Number(stats.malicious ?? 0),
      suspicious: Number(stats.suspicious ?? 0),
      harmless: Number(stats.harmless ?? 0),
      undetected: Number(stats.undetected ?? 0),
      scan_date: body?.data?.attributes?.last_analysis_date ?? null,
      permalink: `https://www.virustotal.com/gui/file/${sha256}`,
      found: true,
    };
  } catch (err: any) {
    return {
      malicious: 0, suspicious: 0, harmless: 0, undetected: 0, found: false,
      error: err?.message ?? "VirusTotal request failed",
    };
  }
}

const ScanInput = z.object({
  fileName: z.string().min(1).max(512),
  mimeType: z.string().max(256).optional().default(""),
  fileSize: z.number().int().nonnegative(),
  contentBase64: z.string().min(1),
  propertyId: z.string().uuid().nullable().optional(),
});

export const scanUploadedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { fileName, mimeType, fileSize, contentBase64, propertyId } = data;

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(contentBase64);
    } catch {
      throw new Error("Invalid base64 payload");
    }

    if (bytes.byteLength !== fileSize && Math.abs(bytes.byteLength - fileSize) > 8) {
      throw new Error("File size mismatch");
    }
    if (bytes.byteLength > MAX_FILE_SIZE) {
      throw new Error("File exceeds 25 MB scan limit");
    }

    const sha256 = await sha256Hex(bytes);
    const heur = runHeuristics(fileName, mimeType ?? "", bytes);

    let vt: VtSummary | null = null;
    // Only query VT when we have a key and heuristics didn't already mark it as safe-to-skip
    // (skip empty/oversize where heuristic already errored).
    if (!heur.hits.includes("empty_file") && !heur.hits.includes("oversize")) {
      vt = await queryVirusTotal(sha256);
    }

    // Combine verdicts
    let finalVerdict: Verdict = heur.verdict;
    const reasons = [...heur.reasons];
    if (vt) {
      if (vt.error) reasons.push(vt.error);
      if (vt.found) {
        if (vt.malicious > 0) {
          finalVerdict = "malicious";
          reasons.push(`VirusTotal: ${vt.malicious} engines flagged as malicious.`);
        } else if (vt.suspicious > 0 && finalVerdict === "clean") {
          finalVerdict = "suspicious";
          reasons.push(`VirusTotal: ${vt.suspicious} engines flagged as suspicious.`);
        } else if (finalVerdict === "clean") {
          reasons.push(
            `VirusTotal clean (${vt.harmless} harmless / ${vt.undetected} undetected).`,
          );
        }
      } else if (!vt.error) {
        reasons.push("VirusTotal: hash not previously seen.");
      }
    } else if (!process.env.VIRUSTOTAL_API_KEY) {
      reasons.push("VirusTotal disabled: no API key configured.");
    }

    const quarantined = finalVerdict === "malicious";

    // Persist scan log (RLS: scanned_by must match auth.uid())
    const { data: logRow, error: logErr } = await context.supabase
      .from("file_scan_logs" as any)
      .insert({
        property_id: propertyId ?? null,
        scanned_by: context.userId,
        file_name: fileName,
        file_size: fileSize,
        mime_type: mimeType || null,
        sha256,
        verdict: finalVerdict,
        heuristics: { hits: heur.hits, reasons: heur.reasons },
        vt_result: vt ?? null,
        vt_malicious: vt?.malicious ?? 0,
        vt_suspicious: vt?.suspicious ?? 0,
        vt_harmless: vt?.harmless ?? 0,
        vt_undetected: vt?.undetected ?? 0,
        reason: reasons.slice(0, 5).join(" "),
        quarantined,
      })
      .select("id")
      .single();

    if (logErr) {
      console.error("file_scan_logs insert failed:", logErr.message);
    }

    return {
      id: (logRow as any)?.id ?? null,
      sha256,
      verdict: finalVerdict,
      quarantined,
      heuristics: heur,
      virustotal: vt,
      reason: reasons.join(" "),
    };
  });

const ListInput = z.object({
  propertyId: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export const listFileScanLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("file_scan_logs" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.propertyId) q = q.eq("property_id", data.propertyId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows as any[]) ?? [];
  });
