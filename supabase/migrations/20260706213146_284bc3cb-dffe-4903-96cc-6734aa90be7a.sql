-- Remove overly permissive brand-read policy on system_settings which exposed
-- all columns (fx_provider, fx_last_error, support contacts, etc.) to any
-- authenticated user. Expose only branding columns via a dedicated view.

DROP POLICY IF EXISTS system_settings_read_brand ON public.system_settings;

CREATE OR REPLACE VIEW public.brand_settings_public
WITH (security_invoker = off) AS
SELECT
  app_name,
  app_short_name,
  tagline,
  logo_url,
  logo_dark_url,
  favicon_url,
  primary_color,
  support_email,
  support_phone
FROM public.system_settings
WHERE id = true;

GRANT SELECT ON public.brand_settings_public TO anon, authenticated;
