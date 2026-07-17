-- Property-scoped brand assets for hotel demo workspaces. The first storage
-- path segment must be a property UUID the current user can access.
CREATE POLICY "property_brand_assets_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.can_access_property(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "property_brand_assets_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND public.has_any_role(
      auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[],
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "property_brand_assets_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.has_any_role(
      auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[],
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "property_brand_assets_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND public.has_any_role(
      auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::public.app_role[],
      ((storage.foldername(name))[1])::uuid
    )
  );
