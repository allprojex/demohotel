-- Fix: Security Definer view (brand_settings_public)
-- Replace the definer view with a SECURITY DEFINER FUNCTION that returns
-- only the safe branding columns. This keeps public brand fetch working
-- for anon/authenticated users without exposing sensitive system_settings
-- columns (fx_provider, fx_last_error, etc.) via a broad RLS policy.

DROP VIEW IF EXISTS public.brand_settings_public;

CREATE OR REPLACE FUNCTION public.get_brand_settings()
RETURNS TABLE (
  app_name text,
  app_short_name text,
  tagline text,
  logo_url text,
  logo_dark_url text,
  favicon_url text,
  primary_color text,
  support_email text,
  support_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.app_name,
    s.app_short_name,
    s.tagline,
    s.logo_url,
    s.logo_dark_url,
    s.favicon_url,
    s.primary_color,
    s.support_email,
    s.support_phone
  FROM public.system_settings s
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_brand_settings() FROM public;
GRANT EXECUTE ON FUNCTION public.get_brand_settings() TO anon, authenticated, service_role;