
-- Ensure GHS currency exists
INSERT INTO public.currencies (code, name, symbol)
SELECT 'GHS', 'Ghanaian Cedi', 'GH₵'
WHERE NOT EXISTS (SELECT 1 FROM public.currencies WHERE code = 'GHS');

-- Change column defaults from USD to GHS
ALTER TABLE public.properties ALTER COLUMN currency SET DEFAULT 'GHS';
ALTER TABLE public.properties ALTER COLUMN base_currency SET DEFAULT 'GHS';
ALTER TABLE public.system_settings ALTER COLUMN default_currency SET DEFAULT 'GHS';

-- Update existing rows that still hold USD
UPDATE public.properties SET currency = 'GHS' WHERE currency = 'USD';
UPDATE public.properties SET base_currency = 'GHS' WHERE base_currency = 'USD';
UPDATE public.system_settings SET default_currency = 'GHS' WHERE default_currency = 'USD';
