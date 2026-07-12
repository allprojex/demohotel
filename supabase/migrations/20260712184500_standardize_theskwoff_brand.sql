-- Keep the property and application branding consistent across the PMS.
UPDATE public.properties
SET name = 'ThesKwoff Hotel'
WHERE code = 'SKWOFF';

UPDATE public.system_settings
SET app_name = 'ThesKwoff Hotel',
    app_short_name = 'ThesKwoff'
WHERE id = true;

ALTER TABLE public.system_settings
  ALTER COLUMN app_name SET DEFAULT 'ThesKwoff Hotel';
