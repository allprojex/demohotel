-- Enable ON CONFLICT upserts from the Permission Matrix UI.
-- role_permissions had no unique constraint matching (property_id, role, module, action),
-- so PostgREST returned 400 for every checkbox toggle.
-- role and custom_role_id are mutually exclusive (CHECK enforces at least one non-null),
-- so we need two partial unique indexes.

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_builtin_uniq
  ON public.role_permissions (property_id, role, module, action)
  WHERE custom_role_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_custom_uniq
  ON public.role_permissions (property_id, custom_role_id, module, action)
  WHERE custom_role_id IS NOT NULL;