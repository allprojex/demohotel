-- Dual Staff/Admin identifiers layered onto the existing profiles, roles and audit model.
-- Existing auth.users are preserved; passwords remain exclusively in Supabase Auth.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auth_account_type') THEN
    CREATE TYPE public.auth_account_type AS ENUM ('staff', 'admin');
  END IF;
END $$;

ALTER TYPE public.profile_status ADD VALUE IF NOT EXISTS 'suspended';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identifier text,
  ADD COLUMN IF NOT EXISTS identifier_normalized text GENERATED ALWAYS AS (lower(identifier)) STORED,
  ADD COLUMN IF NOT EXISTS account_type public.auth_account_type,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_successful_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Elevated roles define the existing application's administrator boundary.
UPDATE public.profiles p
SET account_type = CASE WHEN EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id
    AND ur.role IN ('super_admin','hotel_owner','general_manager')
) THEN 'admin'::public.auth_account_type ELSE 'staff'::public.auth_account_type END
WHERE account_type IS NULL;

-- Collision-free migration identifiers. Administrators can replace these in User & Staff Management.
UPDATE public.profiles
SET identifier = CASE account_type
  WHEN 'admin' THEN 'ADMIN-' || upper(substr(replace(id::text, '-', ''), 1, 8))
  ELSE 'STF-' || upper(substr(replace(id::text, '-', ''), 1, 8))
END
WHERE identifier IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN identifier SET NOT NULL,
  ALTER COLUMN account_type SET NOT NULL;

-- Keep the existing Auth -> profile trigger compatible with the new required fields.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested_identifier text := NEW.raw_user_meta_data->>'identifier';
  requested_type text := NEW.raw_user_meta_data->>'account_type';
BEGIN
  INSERT INTO public.profiles (id, full_name, identifier, account_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New user'),
    CASE
      WHEN requested_identifier ~ '^[A-Za-z0-9._@-]{3,80}$' THEN requested_identifier
      ELSE 'STF-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8))
    END,
    CASE WHEN requested_type = 'admin' THEN 'admin'::public.auth_account_type
         ELSE 'staff'::public.auth_account_type END
  );
  RETURN NEW;
END; $$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_identifier_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_identifier_format
  CHECK (identifier ~ '^[A-Za-z0-9._@-]+$' AND length(identifier) BETWEEN 3 AND 80);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_identifier_normalized_unique
  ON public.profiles(identifier_normalized);

-- Staff may read only their own profile. Existing Admin roles retain scoped directory access.
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id OR public.has_any_role(
      auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[], default_property_id
    )
  );

-- Self-updates must not allow identity or lifecycle escalation.
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier_normalized text NOT NULL,
  account_type public.auth_account_type NOT NULL,
  succeeded boolean NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup_idx
  ON public.login_attempts(identifier_normalized, account_type, created_at DESC);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.login_attempts TO service_role;

-- Auth/login columns are intentionally hidden from broad profile reads.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, avatar_url, default_property_id) ON public.profiles TO authenticated;

-- Permission-matrix entries reuse the existing RBAC table and its constrained action vocabulary.
INSERT INTO public.role_permissions (property_id, role, module, action, allowed)
SELECT p.id, r.role::public.app_role, 'users', a.action, true
FROM public.properties p
CROSS JOIN (VALUES ('super_admin'),('hotel_owner'),('general_manager')) r(role)
CROSS JOIN (VALUES ('read'),('create'),('update'),('manage')) a(action)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (property_id, role, module, action, allowed)
SELECT p.id, r.role::public.app_role, 'admin_console', 'read', true
FROM public.properties p
CROSS JOIN (VALUES ('super_admin'),('hotel_owner'),('general_manager')) r(role)
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.profiles.identifier IS 'Case-preserving Staff ID, username, or Admin ID; login lookup uses identifier_normalized.';
COMMENT ON COLUMN public.profiles.account_type IS 'Server-verified login channel; selecting an Admin tab never changes this value.';
