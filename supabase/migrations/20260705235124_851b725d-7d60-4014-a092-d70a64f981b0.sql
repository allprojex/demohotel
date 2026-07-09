DELETE FROM public.role_permissions
WHERE role = 'manager' AND module = 'reservations' AND action = 'create' AND custom_role_id IS NULL;