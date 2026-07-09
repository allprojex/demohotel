-- 1) Tighten system_settings SELECT to super_admin only.
-- Branding fields required by the UI are exposed through the SECURITY DEFINER
-- get_brand_settings() RPC, so narrowing this policy does not affect the
-- login/brand experience. Non-super admins that previously read fx_provider
-- status directly will now get an empty result; sensitive FX error strings
-- are no longer exposed to hotel_owner / general_manager / accountant.
DROP POLICY IF EXISTS "system_settings_read" ON public.system_settings;
CREATE POLICY "system_settings_read"
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role, NULL));

-- 2) Harden the user_roles admin management policy.
-- Previous policy: hotel_owner / general_manager on a property could grant
-- any role except super_admin / hotel_owner. That still let a GM assign
-- 'general_manager' to another (or their own) user_id on the same property,
-- which is a lateral privilege-escalation path.
--
-- New policy:
--   * super_admin may do anything (unchanged).
--   * hotel_owner / general_manager may INSERT/UPDATE/DELETE role rows on
--     their own property IF:
--       - the target role is NOT one of super_admin / hotel_owner /
--         general_manager (only super_admin may grant these), AND
--       - the target user_id is not themselves (no self-grants).
DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;
CREATE POLICY "user_roles_admin_manage"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role, NULL)
    OR (
      property_id IS NOT NULL
      AND user_id <> auth.uid()
      AND public.has_any_role(
        auth.uid(),
        ARRAY['hotel_owner'::app_role, 'general_manager'::app_role],
        property_id
      )
      AND role <> ALL (ARRAY[
        'super_admin'::app_role,
        'hotel_owner'::app_role,
        'general_manager'::app_role
      ])
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role, NULL)
    OR (
      property_id IS NOT NULL
      AND user_id <> auth.uid()
      AND public.has_any_role(
        auth.uid(),
        ARRAY['hotel_owner'::app_role, 'general_manager'::app_role],
        property_id
      )
      AND role <> ALL (ARRAY[
        'super_admin'::app_role,
        'hotel_owner'::app_role,
        'general_manager'::app_role
      ])
    )
  );