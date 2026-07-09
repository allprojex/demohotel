
DROP POLICY IF EXISTS "uploads_read" ON storage.objects;
CREATE POLICY "uploads_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_write" ON storage.objects;
CREATE POLICY "uploads_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_delete" ON storage.objects;
CREATE POLICY "uploads_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'uploads');
