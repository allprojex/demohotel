
CREATE POLICY "Super admins read backups"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='backups' AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "Super admins write backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='backups' AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "Super admins update backups"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='backups' AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "Super admins delete backups"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='backups' AND public.has_role(auth.uid(),'super_admin'));
