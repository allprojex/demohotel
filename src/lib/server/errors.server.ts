// Server-side logging + structured error helpers.
//
// Goals:
//   - Every server action logs a single-line, greppable event with { op, phase, ms, ...ctx }.
//   - Errors are logged with the original message, code, hint, stack, and any Supabase details.
//   - Errors rethrown to createServerFn callers carry a message the client can surface directly
//     (no more "Unavailable" — the caller sees the exact failing condition).
//   - Server routes (Response-based) get a `httpError()` that returns JSON with the same detail.

export interface LogCtx {
  op: string;
  [key: string]: unknown;
}

function ts() {
  return new Date().toISOString();
}

function safe(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") return obj.slice(0, 2000);
  try {
    const s = JSON.stringify(obj);
    return s.length > 2000 ? s.slice(0, 2000) + "…" : JSON.parse(s);
  } catch {
    return String(obj).slice(0, 2000);
  }
}

export function logInfo(ctx: LogCtx, extra?: Record<string, unknown>) {
  console.log(`[srv] ${ts()} ${ctx.op}`, safe({ ...ctx, ...extra }));
}

export function logWarn(ctx: LogCtx, extra?: Record<string, unknown>) {
  console.warn(`[srv:warn] ${ts()} ${ctx.op}`, safe({ ...ctx, ...extra }));
}

/**
 * Normalize any thrown value into a rich payload we can log AND return to the caller.
 * Handles Supabase PostgrestError shape ({ message, code, hint, details }) as well as
 * plain Error and unknowns.
 */
export function describeError(err: unknown) {
  if (err instanceof Error) {
    const anyErr = err as any;
    return {
      message: err.message || err.name || "Error",
      name: err.name,
      code: anyErr.code ?? anyErr.status ?? null,
      hint: anyErr.hint ?? null,
      details: anyErr.details ?? null,
      stack: err.stack,
    };
  }
  if (err && typeof err === "object") {
    const anyErr = err as any;
    return {
      message: anyErr.message ?? "Unknown server error",
      name: anyErr.name ?? "Object",
      code: anyErr.code ?? anyErr.status ?? null,
      hint: anyErr.hint ?? null,
      details: anyErr.details ?? null,
      stack: null,
    };
  }
  return {
    message: typeof err === "string" ? err : "Unknown server error",
    name: "Unknown",
    code: null,
    hint: null,
    details: null,
    stack: null,
  };
}

/**
 * Wrap a server-function handler body. Logs entry/success/failure with timing,
 * and rethrows failures with a message that includes the operation + original detail
 * so createServerFn callers surface it to the UI.
 */
export async function runServerOp<T>(ctx: LogCtx, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  logInfo({ ...ctx, phase: "start" });
  try {
    const out = await fn();
    logInfo({ ...ctx, phase: "ok", ms: Date.now() - t0 });
    return out;
  } catch (err) {
    const detail = describeError(err);
    console.error(
      `[srv:err] ${ts()} ${ctx.op} ms=${Date.now() - t0}`,
      safe({ ...ctx, ...detail }),
    );
    // Preserve the original message so the client sees it via createServerFn error propagation.
    const parts = [`${ctx.op} failed: ${detail.message}`];
    if (detail.code) parts.push(`code=${detail.code}`);
    if (detail.hint) parts.push(`hint=${detail.hint}`);
    const out = new Error(parts.join(" · "));
    (out as any).cause = err;
    (out as any).code = detail.code;
    throw out;
  }
}

/**
 * Return a JSON error Response for TanStack server routes.
 * Always the same envelope so external callers (Playwright, curl, cron)
 * can parse the failing condition.
 */
export function httpError(
  status: number,
  op: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  const body = { ok: false, op, error: message, ...(extra ?? {}) };
  console.warn(`[srv:http ${status}] ${ts()} ${op}`, safe(body));
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function httpErrorFrom(status: number, op: string, err: unknown) {
  const d = describeError(err);
  return httpError(status, op, d.message, {
    code: d.code,
    hint: d.hint,
    details: d.details,
  });
}
