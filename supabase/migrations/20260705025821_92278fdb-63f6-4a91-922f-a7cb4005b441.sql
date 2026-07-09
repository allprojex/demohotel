
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM (
  'super_admin','hotel_owner','general_manager','front_desk',
  'reservations','cashier','accountant',
  'housekeeping_supervisor','housekeeping','guest'
);

CREATE TYPE public.room_status AS ENUM ('available','occupied','out_of_order','blocked');
CREATE TYPE public.hk_status AS ENUM ('clean','dirty','inspected','maintenance');
CREATE TYPE public.reservation_status AS ENUM ('confirmed','checked_in','checked_out','cancelled','no_show');
CREATE TYPE public.payment_method AS ENUM ('cash','card','bank_transfer','mobile_money','wallet','other');

-- ============ UPDATED_AT TRIGGER FN ============
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  default_property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_upsert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ PROPERTIES ============
CREATE TABLE public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_properties_updated BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, property_id)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- has_role: role check, optional property scope. super_admin implies any role.
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role, _property_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role OR role = 'super_admin')
      AND (_property_id IS NULL OR property_id IS NULL OR property_id = _property_id)
  )
$$;

-- has_any_role: at least one role at property (or global)
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles app_role[], _property_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = ANY(_roles) OR role = 'super_admin')
      AND (_property_id IS NULL OR property_id IS NULL OR property_id = _property_id)
  )
$$;

-- can_access_property: has any staff role at that property (global roles pass)
CREATE OR REPLACE FUNCTION public.can_access_property(_user_id UUID, _property_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (property_id = _property_id OR property_id IS NULL)
  )
$$;

-- Properties policies (needed after has_role exists)
CREATE POLICY "properties_read" ON public.properties FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), id));
CREATE POLICY "properties_admin_write" ON public.properties FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], id));

CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- ============ ROOM TYPES ============
CREATE TABLE public.room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_occupancy INT NOT NULL DEFAULT 2,
  max_occupancy INT NOT NULL DEFAULT 2,
  base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_types TO authenticated;
GRANT ALL ON public.room_types TO service_role;
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_types_read" ON public.room_types FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "room_types_write" ON public.room_types FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_room_types_updated BEFORE UPDATE ON public.room_types FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ ROOMS ============
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES public.room_types(id) ON DELETE RESTRICT,
  number TEXT NOT NULL,
  floor TEXT,
  status room_status NOT NULL DEFAULT 'available',
  housekeeping_status hk_status NOT NULL DEFAULT 'clean',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms_read" ON public.rooms FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "rooms_ops_update" ON public.rooms FOR UPDATE TO authenticated
  USING (public.can_access_property(auth.uid(), property_id))
  WITH CHECK (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "rooms_admin_write" ON public.rooms FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE POLICY "rooms_admin_delete" ON public.rooms FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ RATE PLANS ============
CREATE TABLE public.rate_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  min_stay INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_plans TO authenticated;
GRANT ALL ON public.rate_plans TO service_role;
ALTER TABLE public.rate_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_plans_read" ON public.rate_plans FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "rate_plans_write" ON public.rate_plans FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','reservations']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','reservations']::app_role[], property_id));
CREATE TRIGGER trg_rate_plans_updated BEFORE UPDATE ON public.rate_plans FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ GUESTS ============
CREATE TABLE public.guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  id_type TEXT,
  id_number TEXT,
  nationality TEXT,
  address TEXT,
  vip BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests TO authenticated;
GRANT ALL ON public.guests TO service_role;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guests_read" ON public.guests FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "guests_write" ON public.guests FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','reservations']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','reservations']::app_role[], property_id));
CREATE TRIGGER trg_guests_updated BEFORE UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_guests_property ON public.guests(property_id);
CREATE INDEX idx_guests_name ON public.guests(last_name, first_name);

-- ============ RESERVATIONS ============
CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  guest_id UUID NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
  room_type_id UUID NOT NULL REFERENCES public.room_types(id) ON DELETE RESTRICT,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  adults INT NOT NULL DEFAULT 1,
  children INT NOT NULL DEFAULT 0,
  status reservation_status NOT NULL DEFAULT 'confirmed',
  source TEXT DEFAULT 'direct',
  rate_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code),
  CHECK (check_out > check_in)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "res_read" ON public.reservations FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "res_write" ON public.reservations FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','reservations']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','reservations']::app_role[], property_id));
CREATE TRIGGER trg_res_updated BEFORE UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_res_property_dates ON public.reservations(property_id, check_in, check_out);
CREATE INDEX idx_res_room ON public.reservations(room_id) WHERE room_id IS NOT NULL;

-- Auto-generate reservation code
CREATE OR REPLACE FUNCTION public.gen_reservation_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := 'RES-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 5));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_res_code BEFORE INSERT ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.gen_reservation_code();

-- ============ CHARGES / PAYMENTS / INVOICES ============
CREATE TABLE public.reservation_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservation_charges TO authenticated;
GRANT ALL ON public.reservation_charges TO service_role;
ALTER TABLE public.reservation_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "charges_read" ON public.reservation_charges FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.can_access_property(auth.uid(), r.property_id)));
CREATE POLICY "charges_write" ON public.reservation_charges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], r.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], r.property_id)));

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reference TEXT,
  received_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_read" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.can_access_property(auth.uid(), r.property_id)));
CREATE POLICY "payments_write" ON public.payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], r.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], r.property_id)));

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid NUMERIC(12,2) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_read" ON public.invoices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.can_access_property(auth.uid(), r.property_id)));
CREATE POLICY "inv_write" ON public.invoices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier','accountant']::app_role[], r.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier','accountant']::app_role[], r.property_id)));

-- ============ AUDIT LOG ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  property_id UUID REFERENCES public.properties(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============ BOOTSTRAP: first signed-in user becomes super_admin ============
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_bootstrap AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_super_admin();
