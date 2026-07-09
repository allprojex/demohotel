
-- 1. Extend app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'restaurant_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'waiter';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'kitchen';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'storekeeper';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'auditor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'guest_relations';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'security';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maintenance';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr';

-- 2. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifs_property ON public.notifications(property_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifs_read" ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND property_id IS NOT NULL AND public.can_access_property(auth.uid(), property_id))
  );
CREATE POLICY "notifs_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifs_insert_admin" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    property_id IS NULL
    OR public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id)
  );

CREATE OR REPLACE FUNCTION public.notify(
  _property_id UUID, _user_id UUID, _category TEXT, _priority TEXT,
  _title TEXT, _body TEXT, _link TEXT, _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  INSERT INTO public.notifications(property_id, user_id, category, priority, title, body, link, metadata)
  VALUES (_property_id, _user_id, _category, COALESCE(_priority,'normal'), _title, _body, _link, COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_notify_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify(NEW.property_id, NULL, 'reservation', 'normal',
    'New reservation ' || COALESCE(NEW.code,''),
    'Check-in ' || NEW.check_in::text || ' → ' || NEW.check_out::text,
    '/reservations/' || NEW.id::text, jsonb_build_object('reservation_id', NEW.id));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_reservation ON public.reservations;
CREATE TRIGGER trg_notify_reservation AFTER INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_reservation();

CREATE OR REPLACE FUNCTION public.tg_notify_pos_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='closed' AND (OLD.status IS DISTINCT FROM 'closed') THEN
    PERFORM public.notify(NEW.property_id, NULL, 'pos', 'normal',
      'POS order settled ' || COALESCE(NEW.code,''),
      'Total: GHS ' || NEW.total::text, '/pos/order/' || NEW.id::text,
      jsonb_build_object('order_id', NEW.id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_pos_order ON public.pos_orders;
CREATE TRIGGER trg_notify_pos_order AFTER UPDATE ON public.pos_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_pos_order();

CREATE OR REPLACE FUNCTION public.tg_notify_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prop UUID;
BEGIN
  SELECT property_id INTO _prop FROM public.reservations WHERE id = NEW.reservation_id;
  IF _prop IS NOT NULL THEN
    PERFORM public.notify(_prop, NULL, 'payment', 'normal',
      'Payment received', 'Amount: GHS ' || NEW.amount::text,
      '/reservations/' || NEW.reservation_id::text,
      jsonb_build_object('payment_id', NEW.id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_payment ON public.payments;
CREATE TRIGGER trg_notify_payment AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_payment();

-- 3. User sessions
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  session_key TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT, user_agent TEXT, os TEXT, browser TEXT, device_fingerprint TEXT,
  UNIQUE (user_id, session_key)
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON public.user_sessions(last_seen_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sessions TO authenticated;
GRANT ALL ON public.user_sessions TO service_role;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_rw" ON public.user_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (user_id = auth.uid());

-- 4. Data uploads
CREATE TABLE IF NOT EXISTS public.data_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('menu','product','inventory','service','price_list')),
  filename TEXT NOT NULL,
  storage_path TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','imported')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploads_property ON public.data_uploads(property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.data_upload_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES public.data_uploads(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_rows_upload ON public.data_upload_rows(upload_id, row_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_upload_rows TO authenticated;
GRANT ALL ON public.data_uploads TO service_role;
GRANT ALL ON public.data_upload_rows TO service_role;
ALTER TABLE public.data_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_upload_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uploads_admin" ON public.data_uploads FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE POLICY "upload_rows_admin" ON public.data_upload_rows FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.data_uploads u WHERE u.id=upload_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], u.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.data_uploads u WHERE u.id=upload_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], u.property_id)));

CREATE TRIGGER trg_uploads_updated BEFORE UPDATE ON public.data_uploads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. Audit log extensions
ALTER TABLE public.admin_action_logs
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS os TEXT,
  ADD COLUMN IF NOT EXISTS browser TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS full_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS role_snapshot TEXT;
ALTER TABLE public.admin_action_logs DROP CONSTRAINT IF EXISTS admin_action_logs_action_check;

CREATE OR REPLACE FUNCTION public.audit_capture(
  _property_id UUID, _entity_type TEXT, _entity_id TEXT, _action TEXT,
  _before JSONB, _after JSONB, _memo TEXT,
  _ip TEXT, _user_agent TEXT, _os TEXT, _browser TEXT,
  _fingerprint TEXT, _session_id TEXT, _success BOOLEAN, _remarks TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID; _name TEXT; _role TEXT;
BEGIN
  SELECT full_name INTO _name FROM public.profiles WHERE id = auth.uid();
  SELECT role::text INTO _role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  INSERT INTO public.admin_action_logs(
    property_id, actor_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot, memo,
    ip, user_agent, os, browser, device_fingerprint, session_id,
    success, remarks, full_name_snapshot, role_snapshot
  ) VALUES (
    _property_id, auth.uid(), _entity_type, _entity_id, _action,
    _before, _after, _memo,
    _ip, _user_agent, _os, _browser, _fingerprint, _session_id,
    COALESCE(_success, true), _remarks, _name, _role
  ) RETURNING id INTO _id;
  RETURN _id;
END; $$;

-- 6. RBAC matrix
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_roles TO authenticated;
GRANT ALL ON public.custom_roles TO service_role;
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custom_roles_read" ON public.custom_roles FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.can_access_property(auth.uid(), property_id));
CREATE POLICY "custom_roles_write" ON public.custom_roles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  role public.app_role,
  custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','read','update','delete','approve','export','import','print','manage')),
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role IS NOT NULL OR custom_role_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_perms_builtin
  ON public.role_permissions (property_id, role, module, action) WHERE custom_role_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_perms_custom
  ON public.role_permissions (property_id, custom_role_id, module, action) WHERE custom_role_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_role_perms_lookup ON public.role_permissions(property_id, module, action);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_perms_read" ON public.role_permissions FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.can_access_property(auth.uid(), property_id));
CREATE POLICY "role_perms_write" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- 7. Guest ID types + guest columns
CREATE TABLE IF NOT EXISTS public.guest_id_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gid_system ON public.guest_id_types(code) WHERE property_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gid_property ON public.guest_id_types(property_id, code) WHERE property_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_id_types TO authenticated;
GRANT ALL ON public.guest_id_types TO service_role;
ALTER TABLE public.guest_id_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gid_read" ON public.guest_id_types FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.can_access_property(auth.uid(), property_id));
CREATE POLICY "gid_write" ON public.guest_id_types FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

INSERT INTO public.guest_id_types (property_id, code, name, is_system) VALUES
  (NULL, 'ghana_card', 'Ghana Card (NIA)', true),
  (NULL, 'passport', 'Passport', true),
  (NULL, 'drivers_licence', 'Driver''s Licence', true),
  (NULL, 'voter_id', 'Voter ID Card', true),
  (NULL, 'nhis', 'NHIS Card', true),
  (NULL, 'birth_certificate', 'Birth Certificate', true),
  (NULL, 'other', 'Other (Foreign National)', true)
ON CONFLICT DO NOTHING;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS id_type_id UUID REFERENCES public.guest_id_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nationality_code TEXT,
  ADD COLUMN IF NOT EXISTS region_code TEXT,
  ADD COLUMN IF NOT EXISTS region_capital TEXT;
