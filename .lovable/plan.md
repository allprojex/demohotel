## What we're adding

Three enhancements to the existing Security Center and Printer Manager:

1. **Exportable compliance/audit log** under Security Center with date-range + type filters, CSV + PDF export
2. **Print job queue UI** with live status, error details, retry & cancel actions
3. **Per-property printer routing rules** that auto-select a printer by job type

No new business-domain concepts — everything sits on existing tables (`security_events`, `audit_logs`, `print_jobs`, `printers`) plus one small new table for routing rules.

---

### 1. Compliance / audit log export (Security Center)

New tab **"Compliance Log"** on `/admin/security` combining `security_events` + `audit_logs` into a unified, filterable timeline.

Filters:
- Date range (from / to, default: last 30 days)
- Source (security events, audit logs, both)
- Severity (for security events) / Action (free text search for audit)
- User, Property

Actions:
- **Export CSV** — streamed from a server fn, all filtered rows
- **Export PDF** — server-generated compliance report (header with property, date range, generated-by, table of events, page numbers)

Server fns in new `src/lib/security/compliance.functions.ts`:
- `queryComplianceLog({ from, to, source, severity, userId, propertyId, limit })`
- `exportComplianceCsv(filters)` → returns CSV string
- `exportCompliancePdf(filters)` → returns base64 PDF (using `pdf-lib`, already a common lightweight option; fallback: server-generated HTML + client-side print)

Access gated by `is_security_admin` (matches existing policies).

### 2. Universal print job queue UI

New tab **"Job Queue"** on `/admin/printers` (currently the page only lists printers).

Table columns: Created, Job type, Title, Printer, Copies, Status badge, Error, Actions.

Features:
- Auto-refresh every 3s via TanStack Query `refetchInterval`
- Filter: status (all / pending / processing / failed / completed / cancelled), job type, date range
- Row actions:
  - **Retry** (failed/cancelled → resets to `pending`, clears `error`, `started_at`, `completed_at`)
  - **Cancel** (pending/processing → `cancelled`)
  - **View details** drawer with full metadata + error stack
- Bulk retry / bulk cancel for selected rows

Server fns in `src/lib/printer/print-queue.functions.ts`:
- `listPrintJobs(filters)`
- `retryPrintJob(id)` / `cancelPrintJob(id)` / `bulkRetry(ids)` / `bulkCancel(ids)`

All gated to job owner or security admin (matches existing RLS).

### 3. Per-property printer routing rules

**New table** `printer_routing_rules`:
- `property_id` (fk)
- `job_type` (matches `print_jobs.job_type` enum values: receipt, invoice, label, barcode, report, document, kot, bill)
- `printer_id` (fk)
- `priority` (int, lower = tried first)
- `is_active` (bool)
- Unique on (`property_id`, `job_type`, `priority`)

RLS: security admins manage; all authenticated users read (needed for client-side routing lookup at print time).

**Routing resolver** — new helper `resolvePrinterForJob({ propertyId, jobType })`:
1. Look up active rules for property + job type, ordered by priority
2. Return first printer whose status is not `error` (or first if none online)
3. Fall back to property's `is_default = true` printer
4. Return null if nothing found (caller shows "no printer configured" error)

Wired into:
- `useWebPrinter` / `usePrintNode` hooks — when caller doesn't pass an explicit `printerId`, they resolve one via the rule
- `printers.functions.ts` `enqueuePrintJob` server fn — same resolution server-side

**New UI** on `/admin/printers` → tab **"Routing Rules"**:
- Grid of job types × configured printers
- Add rule form (job type dropdown, printer dropdown, priority)
- Reorder priority via up/down buttons
- Toggle active

### Sidebar / navigation

No new nav entries — everything lives as tabs inside existing `/admin/security` and `/admin/printers` pages.

---

### Technical details

**Migration** (single file):
- `CREATE TABLE public.printer_routing_rules` with GRANTs, RLS, policies, `updated_at` trigger
- No changes to existing tables

**PDF generation**: use `pdf-lib` (pure JS, Worker-compatible — no native deps). Install via `bun add pdf-lib`.

**CSV**: hand-rolled with proper escaping (already done elsewhere in the app); no new dep.

**Files created**:
- `supabase/migrations/<ts>_printer_routing_rules.sql`
- `src/lib/security/compliance.functions.ts`
- `src/lib/printer/print-queue.functions.ts`
- `src/lib/printer/routing.functions.ts` + `src/lib/printer/routing.ts` (client resolver)
- `src/components/security/compliance-log-tab.tsx`
- `src/components/printer/print-queue-tab.tsx`
- `src/components/printer/routing-rules-tab.tsx`

**Files edited**:
- `src/routes/_authenticated/admin_.security.tsx` — add Compliance Log tab
- `src/routes/_authenticated/admin_.printers.tsx` — add Job Queue & Routing Rules tabs
- `src/lib/printer/printers.functions.ts` — use routing resolver in enqueue
- `src/hooks/use-web-printer.ts`, `src/hooks/use-printnode.ts` — resolve printer when none passed
- `src/integrations/supabase/types.ts` — regenerated after migration

No changes to existing security/audit tables or their RLS.
