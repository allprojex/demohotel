-- Required private buckets. Object access remains governed by the existing
-- storage.objects RLS policies; these inserts only ensure the containers exist.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('uploads', 'uploads', false),
  ('backups', 'backups', false),
  ('brand-assets', 'brand-assets', false)
ON CONFLICT (id) DO NOTHING;
