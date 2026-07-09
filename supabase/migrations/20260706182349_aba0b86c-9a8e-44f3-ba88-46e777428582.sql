
-- 1) Brand fields on the singleton system_settings row.
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS app_name        text NOT NULL DEFAULT 'Infinity Techub PMS',
  ADD COLUMN IF NOT EXISTS app_short_name  text,
  ADD COLUMN IF NOT EXISTS tagline         text,
  ADD COLUMN IF NOT EXISTS logo_url        text,
  ADD COLUMN IF NOT EXISTS logo_dark_url   text,
  ADD COLUMN IF NOT EXISTS favicon_url     text,
  ADD COLUMN IF NOT EXISTS primary_color   text,
  ADD COLUMN IF NOT EXISTS support_email   text,
  ADD COLUMN IF NOT EXISTS support_phone   text,
  ADD COLUMN IF NOT EXISTS updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Allow authenticated (non-admin) users to read brand-display fields so the
-- sidebar/logo render for everyone; existing RLS SELECT policy already covers
-- admins reading the full row, and PostgREST enforces column-level GRANT.
GRANT SELECT (app_name, app_short_name, tagline, logo_url, logo_dark_url,
              favicon_url, primary_color, support_email, support_phone)
  ON public.system_settings TO authenticated;

-- Widen the SELECT policy to permit any authenticated user to see the row
-- (they still only get the columns granted above).
DROP POLICY IF EXISTS "system_settings_read_brand" ON public.system_settings;
CREATE POLICY "system_settings_read_brand"
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) Storage RLS on the brand-assets bucket (bucket created via storage tool).
-- Public read (so signed URLs & anonymous <img> fetches within grace period work),
-- writes restricted to super_admin.
DROP POLICY IF EXISTS "brand_assets_read"   ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_insert" ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_update" ON storage.objects;
DROP POLICY IF EXISTS "brand_assets_delete" ON storage.objects;

CREATE POLICY "brand_assets_read"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'brand-assets');

CREATE POLICY "brand_assets_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  );

CREATE POLICY "brand_assets_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  )
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  );

CREATE POLICY "brand_assets_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  );
