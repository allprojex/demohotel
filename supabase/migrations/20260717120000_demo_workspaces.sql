-- Multi-hotel demo workspaces. Testers control only their own property and never
-- receive platform ownership or a global super_admin grant.

DROP TRIGGER IF EXISTS on_auth_user_bootstrap ON auth.users;
DROP FUNCTION IF EXISTS public.bootstrap_super_admin();

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS demo_created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS demo_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS brand_tagline text,
  ADD COLUMN IF NOT EXISTS brand_primary_color text,
  ADD COLUMN IF NOT EXISTS brand_logo_url text;

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_demo_expiry_required;
ALTER TABLE public.properties ADD CONSTRAINT properties_demo_expiry_required
  CHECK (NOT is_demo OR demo_expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS properties_demo_expiry_idx
  ON public.properties(demo_expires_at) WHERE is_demo;

-- Demo hotel owners can customize their own property, but cannot turn it into a
-- permanent/non-demo workspace or change who created it.
CREATE OR REPLACE FUNCTION public.protect_demo_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_demo AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin']::public.app_role[], NULL) THEN
    NEW.is_demo := true;
    NEW.demo_expires_at := OLD.demo_expires_at;
    NEW.demo_created_by := OLD.demo_created_by;
    NEW.demo_terms_accepted_at := OLD.demo_terms_accepted_at;
    NEW.active := OLD.active;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_demo_ownership ON public.properties;
CREATE TRIGGER trg_protect_demo_ownership
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.protect_demo_ownership();

COMMENT ON COLUMN public.properties.is_demo IS 'Platform-owned evaluation workspace; hotel users receive usage rights only.';
COMMENT ON COLUMN public.properties.demo_expires_at IS 'Date after which the platform may suspend or reset this demo workspace.';

DROP POLICY IF EXISTS "properties_admin_write" ON public.properties;
CREATE POLICY "properties_admin_update" ON public.properties FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[], id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[], id));
CREATE POLICY "properties_super_admin_insert" ON public.properties FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin']::public.app_role[], NULL));
CREATE POLICY "properties_super_admin_delete" ON public.properties FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::public.app_role[], NULL));
