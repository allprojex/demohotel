
-- 1. Aging views: honor caller's RLS instead of view-owner permissions.
ALTER VIEW public.ar_aging SET (security_invoker = true);
ALTER VIEW public.ap_aging SET (security_invoker = true);

-- 2. rate_plans public read must also require the parent property to be public + active.
DROP POLICY IF EXISTS rate_plans_public_read ON public.rate_plans;
CREATE POLICY rate_plans_public_read ON public.rate_plans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.room_types rt
      JOIN public.properties p ON p.id = rt.property_id
      WHERE rt.id = rate_plans.room_type_id
        AND rt.is_public
        AND p.is_public
        AND p.active
    )
  );

-- 3. Notifications insert: block cross-user "system" notification phishing.
DROP POLICY IF EXISTS notifs_insert_admin ON public.notifications;
CREATE POLICY notifs_insert_admin ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (property_id IS NULL AND user_id = auth.uid())
    OR (
      property_id IS NOT NULL
      AND public.has_any_role(
        auth.uid(),
        ARRAY['super_admin','hotel_owner','general_manager']::app_role[],
        property_id
      )
    )
  );
