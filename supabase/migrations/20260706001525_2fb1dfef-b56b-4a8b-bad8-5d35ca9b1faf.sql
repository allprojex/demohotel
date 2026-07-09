
DROP INDEX IF EXISTS public.role_permissions_builtin_uniq;
DROP INDEX IF EXISTS public.role_permissions_custom_uniq;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_builtin_uniq;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_custom_uniq;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_full_uniq;

ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_full_uniq
  UNIQUE NULLS NOT DISTINCT (property_id, role, custom_role_id, module, action);
