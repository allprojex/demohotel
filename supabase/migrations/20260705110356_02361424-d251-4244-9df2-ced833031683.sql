
-- channels_read: scope to authenticated
DROP POLICY IF EXISTS channels_read ON public.channels;
CREATE POLICY channels_read ON public.channels
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- accounting_sync_runs: scope both policies to authenticated
DROP POLICY IF EXISTS sync_runs_read ON public.accounting_sync_runs;
CREATE POLICY sync_runs_read ON public.accounting_sync_runs
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

DROP POLICY IF EXISTS sync_runs_write ON public.accounting_sync_runs;
CREATE POLICY sync_runs_write ON public.accounting_sync_runs
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

-- accounting_sync_targets: scope write policy to authenticated
DROP POLICY IF EXISTS sync_targets_write ON public.accounting_sync_targets;
CREATE POLICY sync_targets_write ON public.accounting_sync_targets
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

-- system_settings_read: restrict to admin roles across any property
DROP POLICY IF EXISTS system_settings_read ON public.system_settings;
CREATE POLICY system_settings_read ON public.system_settings
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('hotel_owner','general_manager','accountant')
    )
  );
