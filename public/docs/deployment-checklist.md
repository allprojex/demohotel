# Admin Deployment Checklist — ThesKwoff Hotel

Run this checklist end-to-end before declaring a deployment ready. Every item must be checked.

## 1. Runtime

- [ ] `node -v` reports **v20.x** or **v22.x** (verified LTS).
- [ ] `npm -v` >= 10 (or `bun -v` if using Bun).
- [ ] Server user (`pms`) exists and owns the app directory.

```bash
node -v && npm -v && id pms
```

## 2. Environment variables

- [ ] `.env` present, `chmod 600`, owned by service user.
- [ ] `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` set.
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` set.
- [ ] `NODE_ENV=production`, `PORT=3000`.
- [ ] Secret keys (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) NOT world-readable.

```bash
sudo -u pms bash -c 'set -a; . /opt/infinity-pms/.env; env | grep -E "^(NODE_ENV|PORT|SUPABASE_URL)="'
```

## 3. Database connectivity

- [ ] `/api/public/health` returns **HTTP 200** with `checks.database.ok = true`.
- [ ] Response `checks.database.ms` < 500 ms (LAN) / < 2000 ms (WAN).

```bash
./scripts/healthcheck.sh http://localhost:3000
```

## 4. Migrations

- [ ] All migrations in `supabase/migrations/` have been applied to the target project.
- [ ] `brand_settings_public` view exists and returns a row.
- [ ] `user_roles`, `role_permissions`, `custom_roles` tables exist and are RLS-enabled.

Verify via SQL (using an admin console or `psql`):

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN ('user_roles','role_permissions','custom_roles');
-- expect 3

SELECT app_name FROM public.brand_settings_public LIMIT 1;
```

## 5. Background jobs (cron / pg_cron)

- [ ] `CRON_SECRET` set in `.env`.
- [ ] Each hook responds **200** when called with the correct secret and **401** without.

```bash
BASE=http://localhost:3000
for path in fx-refresh channel-sync backup-run analytics-exports accounting-sync; do
  echo "→ $path"
  curl -sS -o /dev/null -w '  no secret:  %{http_code}\n' -X POST "$BASE/api/public/hooks/$path"
  curl -sS -o /dev/null -w '  with secret: %{http_code}\n' -X POST \
    -H "x-cron-secret: $CRON_SECRET" "$BASE/api/public/hooks/$path"
done
```

- [ ] pg_cron schedule for each job configured (fx hourly, channel-sync every 15 min, backup nightly, analytics-exports every 5 min, accounting-sync nightly).

## 6. Reverse proxy & TLS

- [ ] Nginx `nginx -t` passes.
- [ ] `sudo systemctl reload nginx` clean.
- [ ] HTTPS certificate valid (`openssl s_client -connect host:443 -servername host <<<""`).
- [ ] `curl -Ik https://<domain>` returns 200 for `/` and `/api/public/health`.

## 7. Service manager

- [ ] `systemctl is-active infinity-pms` → `active`.
- [ ] `systemctl is-enabled infinity-pms` → `enabled`.
- [ ] `journalctl -u infinity-pms -n 100 --no-pager` shows no repeated errors in the last 5 minutes.

## 8. Application smoke test

- [ ] `/` loads and shows the app landing.
- [ ] `/auth` allows sign-in for a test admin.
- [ ] `/admin/security` opens and shows Firewall + Threats tabs.
- [ ] `/settings/roles-matrix` — admin sees the Download / Print menu with CSV, PDF, Print options.
- [ ] Notifications bell shows recent events.

## 9. Security

- [ ] All RLS policies in place (run in-app Security Scan).
- [ ] No secrets echoed in `journalctl` output.
- [ ] File Firewall enabled in **Admin → Security Center → File Firewall**.
- [ ] Backup schedule created and last run succeeded within 24 h.

## 10. Sign-off

- [ ] Deployment date/time recorded: __________________
- [ ] Deployed by: __________________
- [ ] Version tag: __________________
- [ ] Rollback plan verified (previous release archive kept, DB backup < 1 h old).

**Only when every box is checked is the deployment considered ready.**
