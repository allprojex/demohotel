UPDATE public.system_settings
SET app_name = 'Infinity Grand Hotel',
    app_short_name = 'Infinity Grand',
    tagline = 'Experience the complete hotel management platform'
WHERE id = true;

ALTER TABLE public.system_settings
  ALTER COLUMN app_name SET DEFAULT 'Infinity Grand Hotel';
