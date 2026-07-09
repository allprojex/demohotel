
-- ============================================================================
-- Part 1: Harden role authorization functions
-- NULL _property_id no longer wildcards non-super_admin roles.
-- Global access now requires role = 'super_admin' explicitly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role, _property_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        -- super_admin is always global
        ur.role = 'super_admin'
        -- otherwise require an explicit property match; NULL property is only allowed for super_admin
        OR (ur.role = _role AND _property_id IS NOT NULL AND ur.property_id = _property_id)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[], _property_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'super_admin'
        OR (ur.role = ANY(_roles) AND _property_id IS NOT NULL AND ur.property_id = _property_id)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_access_property(_user_id uuid, _property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'super_admin'
        OR (_property_id IS NOT NULL AND ur.property_id = _property_id)
      )
  )
$function$;

-- CHECK: only super_admin rows may have NULL property_id
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_null_scope_super_only;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_null_scope_super_only
  CHECK (property_id IS NOT NULL OR role = 'super_admin');

-- Tighten write policy: property-scoped admins may only write property-scoped rows.
-- Global (NULL) rows can only be created/updated by an existing super_admin.
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin', NULL)
  OR (property_id IS NOT NULL AND public.has_any_role(auth.uid(),
      ARRAY['hotel_owner','general_manager']::app_role[], property_id))
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin', NULL)
  OR (property_id IS NOT NULL AND public.has_any_role(auth.uid(),
      ARRAY['hotel_owner','general_manager']::app_role[], property_id))
);

-- ============================================================================
-- Part 2: Revoke EXECUTE from anon on public SECURITY DEFINER functions
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- ============================================================================
-- Part 3: Drop unused sensitive columns / tighten sensitive policies
-- ============================================================================

-- channels.credentials is not used by application code; remove it.
-- OTA credentials should be stored as Lovable Cloud secrets, not per-row JSON.
ALTER TABLE public.channels DROP COLUMN IF EXISTS credentials;

-- accounting_sync_targets.signing_secret: restrict read to admin roles only.
DROP POLICY IF EXISTS sync_targets_read ON public.accounting_sync_targets;
CREATE POLICY sync_targets_read ON public.accounting_sync_targets
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(),
  ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- ============================================================================
-- Part 4: System settings (singleton) + default currency GHS
-- ============================================================================

INSERT INTO public.currencies(code, name, symbol, decimals)
VALUES ('GHS', 'Ghanaian Cedi', 'GH₵', 2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  default_currency text NOT NULL DEFAULT 'GHS' REFERENCES public.currencies(code),
  fx_provider text NOT NULL DEFAULT 'exchangerate.host',
  fx_refresh_interval_minutes integer NOT NULL DEFAULT 60 CHECK (fx_refresh_interval_minutes >= 5),
  fx_last_synced_at timestamptz,
  fx_last_status text,
  fx_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_read ON public.system_settings;
CREATE POLICY system_settings_read ON public.system_settings
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS system_settings_write ON public.system_settings;
CREATE POLICY system_settings_write ON public.system_settings
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin', NULL))
WITH CHECK (public.has_role(auth.uid(), 'super_admin', NULL));

INSERT INTO public.system_settings(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS system_settings_touch ON public.system_settings;
CREATE TRIGGER system_settings_touch BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- Part 5: Profile lifecycle (approve / activate / deactivate)
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_status') THEN
    CREATE TYPE public.profile_status AS ENUM ('pending','active','disabled');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.profile_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;
