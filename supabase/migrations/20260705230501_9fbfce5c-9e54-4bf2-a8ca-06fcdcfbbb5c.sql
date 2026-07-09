DROP POLICY IF EXISTS "uploads_read"   ON storage.objects;
DROP POLICY IF EXISTS "uploads_write"  ON storage.objects;
DROP POLICY IF EXISTS "uploads_update" ON storage.objects;
DROP POLICY IF EXISTS "uploads_delete" ON storage.objects;

CREATE POLICY "uploads_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.can_access_property(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "uploads_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "uploads_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "uploads_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], ((storage.foldername(name))[1])::uuid)
  );