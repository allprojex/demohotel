# Supabase Migration

Use this when moving the app to a new Supabase account/project.

## What the app needs

The VPS environment must contain:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The project also uses Supabase Auth, Storage, Postgres tables, RLS policies, RPC functions, triggers, and migrations in `supabase/migrations`.

## 1. Create the new Supabase project

In Supabase:

1. Create a new project.
2. Copy the project ref, API URL, publishable key, and service role key.
3. Add the production URL in Auth redirect settings:
   - `https://YOUR_DOMAIN`
   - `https://YOUR_DOMAIN/auth`
   - any reset-password or booking URLs used by the business.

## 2. Apply schema migrations

Install the Supabase CLI locally or on a trusted admin machine:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_NEW_PROJECT_REF
supabase db push
```

Run this from the project root so the CLI reads `supabase/migrations`.

If the CLI reports migration conflicts, stop and inspect the new project. A fresh project should accept the migrations in timestamp order.

## 3. Migrate existing data

If you have access to the old Supabase database password:

```bash
pg_dump \
  --data-only \
  --no-owner \
  --no-privileges \
  --dbname "postgresql://postgres:OLD_DB_PASSWORD@db.OLD_PROJECT_REF.supabase.co:5432/postgres" \
  --file infinity-pms-data.sql

psql \
  "postgresql://postgres:NEW_DB_PASSWORD@db.NEW_PROJECT_REF.supabase.co:5432/postgres" \
  --file infinity-pms-data.sql
```

For a clean launch without old data, skip this step and create the first users/properties in the new app.

## 4. Storage buckets and files

The migrations create database objects, but file objects in Supabase Storage must be copied separately.
Check the old project's Storage section for buckets used by uploads, brand assets, guest IDs, reports, or backups.

Recommended options:

- Download bucket contents from the old project and upload to the same bucket names in the new project.
- Use a one-off Supabase Storage script with the old and new service role keys.

Keep bucket names and object paths unchanged so existing database rows still point to the right files.

## 5. Auth users

Supabase Auth users are separate from application tables.

Recommended options:

- For a new deployment, invite users again from the app.
- For a full migration, export/import Auth users using Supabase-supported admin tooling, then verify profile IDs still match app tables.

Do not import user passwords manually. Use password reset/invite flows when unsure.

## 6. Regenerate TypeScript types

After migrations are applied:

```bash
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

Commit the regenerated types if they changed.

## 7. Final verification

On the VPS:

```bash
npm run build
sudo systemctl restart infinity-pms
curl https://YOUR_DOMAIN/api/public/health
```

Then verify:

- Login works.
- A property can be selected.
- Dashboard loads.
- Reservations, rooms, guests, POS, inventory, and admin pages load for an admin account.
- File uploads and brand logo display correctly.
