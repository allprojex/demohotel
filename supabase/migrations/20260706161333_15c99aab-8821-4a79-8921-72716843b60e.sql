
-- Restrict property-level admins from assigning privileged roles (super_admin, hotel_owner)
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;

CREATE POLICY user_roles_admin_manage ON public.user_roles
AS PERMISSIVE FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  OR (
    property_id IS NOT NULL
    AND has_any_role(auth.uid(), ARRAY['hotel_owner'::app_role, 'general_manager'::app_role], property_id)
    AND role NOT IN ('super_admin'::app_role, 'hotel_owner'::app_role)
  )
)
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  OR (
    property_id IS NOT NULL
    AND has_any_role(auth.uid(), ARRAY['hotel_owner'::app_role, 'general_manager'::app_role], property_id)
    AND role NOT IN ('super_admin'::app_role, 'hotel_owner'::app_role)
  )
);

-- Re-affirm notifications insert policy: system-scope notifications (property_id IS NULL)
-- may only be inserted by super_admin, or by the user for themselves.
DROP POLICY IF EXISTS notifs_insert_admin ON public.notifications;

CREATE POLICY notifs_insert_admin ON public.notifications
AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  (
    property_id IS NULL
    AND user_id IS NOT NULL
    AND user_id = auth.uid()
  )
  OR (
    property_id IS NULL
    AND has_role(auth.uid(), 'super_admin'::app_role, NULL::uuid)
  )
  OR (
    property_id IS NOT NULL
    AND has_any_role(auth.uid(), ARRAY['super_admin'::app_role, 'hotel_owner'::app_role, 'general_manager'::app_role], property_id)
  )
);
