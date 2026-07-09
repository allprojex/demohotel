
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_builtin_uniq;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_custom_uniq;
DROP INDEX IF EXISTS public.role_permissions_builtin_uniq;
DROP INDEX IF EXISTS public.role_permissions_custom_uniq;

CREATE UNIQUE INDEX role_permissions_builtin_uniq
  ON public.role_permissions (property_id, role, module, action) NULLS NOT DISTINCT
  WHERE custom_role_id IS NULL;

CREATE UNIQUE INDEX role_permissions_custom_uniq
  ON public.role_permissions (property_id, custom_role_id, module, action) NULLS NOT DISTINCT
  WHERE role IS NULL;
