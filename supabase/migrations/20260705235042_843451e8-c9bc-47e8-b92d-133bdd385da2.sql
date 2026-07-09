DROP INDEX IF EXISTS public.role_permissions_builtin_uniq;
DROP INDEX IF EXISTS public.role_permissions_custom_uniq;

ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_builtin_uniq
  UNIQUE (property_id, role, module, action);

ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_custom_uniq
  UNIQUE (property_id, custom_role_id, module, action);