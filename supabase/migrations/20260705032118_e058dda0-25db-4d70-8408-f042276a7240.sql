
-- ============ SECURITY FIX: profiles read policy ============
DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);
CREATE POLICY "profiles_admin_select" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], NULL));

-- ============ ENUMS (inventory + POS) ============
CREATE TYPE public.po_status AS ENUM ('draft','sent','partial','received','cancelled');
CREATE TYPE public.transfer_status AS ENUM ('draft','completed','cancelled');
CREATE TYPE public.location_kind AS ENUM ('store','bar','kitchen','housekeeping','other');
CREATE TYPE public.outlet_kind AS ENUM ('restaurant','bar','room_service','other');
CREATE TYPE public.pos_table_status AS ENUM ('free','occupied','reserved');
CREATE TYPE public.pos_order_status AS ENUM ('open','sent','served','closed','void');

-- Helper: short random code
CREATE OR REPLACE FUNCTION public.short_code(prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT prefix || '-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 5))
$$;

-- Role convenience arrays (macros not supported; inline below)

-- ============ SUPPLIERS ============
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT, email TEXT, phone TEXT, address TEXT,
  payment_terms TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_read ON public.suppliers FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY suppliers_write ON public.suppliers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ ITEM CATEGORIES ============
CREATE TABLE public.item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_categories TO authenticated;
GRANT ALL ON public.item_categories TO service_role;
ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_cat_read ON public.item_categories FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY item_cat_write ON public.item_categories FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- ============ STOCK LOCATIONS ============
CREATE TABLE public.stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind location_kind NOT NULL DEFAULT 'store',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_locations TO authenticated;
GRANT ALL ON public.stock_locations TO service_role;
ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_loc_read ON public.stock_locations FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY stock_loc_write ON public.stock_locations FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- ============ INVENTORY ITEMS ============
CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.item_categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, sku)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_items_read ON public.inventory_items FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY inv_items_write ON public.inventory_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_inv_items_updated BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ ITEM STOCK (per location) ============
CREATE TABLE public.item_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(item_id, location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_stock TO authenticated;
GRANT ALL ON public.item_stock TO service_role;
ALTER TABLE public.item_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_stock_read ON public.item_stock FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY item_stock_write ON public.item_stock FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier','housekeeping_supervisor']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier','housekeeping_supervisor']::app_role[], property_id));

-- Helper to upsert stock delta atomically
CREATE OR REPLACE FUNCTION public.apply_stock_delta(_property_id UUID, _item_id UUID, _location_id UUID, _delta NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.item_stock(property_id, item_id, location_id, quantity, updated_at)
  VALUES (_property_id, _item_id, _location_id, _delta, now())
  ON CONFLICT (item_id, location_id) DO UPDATE
    SET quantity = public.item_stock.quantity + EXCLUDED.quantity,
        updated_at = now();
END; $$;

-- ============ PURCHASE ORDERS ============
CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  location_id UUID REFERENCES public.stock_locations(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  status po_status NOT NULL DEFAULT 'draft',
  ordered_at TIMESTAMPTZ,
  expected_at DATE,
  received_at TIMESTAMPTZ,
  notes TEXT,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_read ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY po_write ON public.purchase_orders FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE OR REPLACE FUNCTION public.gen_po_code() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('PO'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_po_code BEFORE INSERT ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.gen_po_code();

CREATE TABLE public.purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(14,3) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_lines TO authenticated;
GRANT ALL ON public.purchase_order_lines TO service_role;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol_read ON public.purchase_order_lines FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=po_id AND public.can_access_property(auth.uid(), p.property_id)));
CREATE POLICY pol_write ON public.purchase_order_lines FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=po_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], p.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.purchase_orders p WHERE p.id=po_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], p.property_id)));

-- Receive PO: move lines' remaining qty into destination stock
CREATE OR REPLACE FUNCTION public.receive_purchase_order(_po_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; p RECORD;
BEGIN
  SELECT * INTO p FROM public.purchase_orders WHERE id = _po_id;
  IF p IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], p.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF p.location_id IS NULL THEN RAISE EXCEPTION 'PO has no destination location'; END IF;
  FOR r IN SELECT * FROM public.purchase_order_lines WHERE po_id = _po_id LOOP
    IF r.quantity - r.received_qty > 0 THEN
      PERFORM public.apply_stock_delta(p.property_id, r.item_id, p.location_id, r.quantity - r.received_qty);
      UPDATE public.purchase_order_lines SET received_qty = r.quantity WHERE id = r.id;
    END IF;
  END LOOP;
  UPDATE public.purchase_orders SET status='received', received_at=now() WHERE id=_po_id;
END; $$;

-- ============ STOCK TRANSFERS ============
CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  from_location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  to_location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  status transfer_status NOT NULL DEFAULT 'draft',
  transferred_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, code),
  CHECK (from_location_id <> to_location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY st_read ON public.stock_transfers FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY st_write ON public.stock_transfers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_st_updated BEFORE UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE OR REPLACE FUNCTION public.gen_transfer_code() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('TR'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_st_code BEFORE INSERT ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.gen_transfer_code();

CREATE TABLE public.stock_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_lines TO authenticated;
GRANT ALL ON public.stock_transfer_lines TO service_role;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stl_read ON public.stock_transfer_lines FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.stock_transfers t WHERE t.id=transfer_id AND public.can_access_property(auth.uid(), t.property_id)));
CREATE POLICY stl_write ON public.stock_transfer_lines FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.stock_transfers t WHERE t.id=transfer_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], t.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.stock_transfers t WHERE t.id=transfer_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], t.property_id)));

CREATE OR REPLACE FUNCTION public.execute_transfer(_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; t RECORD;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id=_id;
  IF t IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], t.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF t.status = 'completed' THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id=_id LOOP
    PERFORM public.apply_stock_delta(t.property_id, r.item_id, t.from_location_id, -r.quantity);
    PERFORM public.apply_stock_delta(t.property_id, r.item_id, t.to_location_id, r.quantity);
  END LOOP;
  UPDATE public.stock_transfers SET status='completed', transferred_at=now() WHERE id=_id;
END; $$;

-- ============ STOCK ADJUSTMENTS ============
CREATE TABLE public.stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.stock_locations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  adjusted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sa_read ON public.stock_adjustments FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY sa_write ON public.stock_adjustments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','housekeeping_supervisor']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','housekeeping_supervisor']::app_role[], property_id));
CREATE TRIGGER trg_sa_updated BEFORE UPDATE ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE OR REPLACE FUNCTION public.gen_adj_code() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('ADJ'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_sa_code BEFORE INSERT ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.gen_adj_code();

CREATE TABLE public.stock_adjustment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  delta NUMERIC(14,3) NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustment_lines TO authenticated;
GRANT ALL ON public.stock_adjustment_lines TO service_role;
ALTER TABLE public.stock_adjustment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sal_read ON public.stock_adjustment_lines FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.stock_adjustments a WHERE a.id=adjustment_id AND public.can_access_property(auth.uid(), a.property_id)));
CREATE POLICY sal_write ON public.stock_adjustment_lines FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.stock_adjustments a WHERE a.id=adjustment_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','housekeeping_supervisor']::app_role[], a.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.stock_adjustments a WHERE a.id=adjustment_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','housekeeping_supervisor']::app_role[], a.property_id)));

CREATE OR REPLACE FUNCTION public.apply_adjustment(_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; a RECORD;
BEGIN
  SELECT * INTO a FROM public.stock_adjustments WHERE id=_id;
  IF a IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF a.adjusted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','housekeeping_supervisor']::app_role[], a.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  FOR r IN SELECT * FROM public.stock_adjustment_lines WHERE adjustment_id=_id LOOP
    PERFORM public.apply_stock_delta(a.property_id, r.item_id, a.location_id, r.delta);
  END LOOP;
  UPDATE public.stock_adjustments SET adjusted_at=now() WHERE id=_id;
END; $$;

-- ============ POS OUTLETS ============
CREATE TABLE public.pos_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind outlet_kind NOT NULL DEFAULT 'restaurant',
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_outlets TO authenticated;
GRANT ALL ON public.pos_outlets TO service_role;
ALTER TABLE public.pos_outlets ENABLE ROW LEVEL SECURITY;
CREATE POLICY out_read ON public.pos_outlets FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY out_write ON public.pos_outlets FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_outlets_updated BEFORE UPDATE ON public.pos_outlets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ MENU CATEGORIES + ITEMS ============
CREATE TABLE public.pos_menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES public.pos_outlets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_menu_categories TO authenticated;
GRANT ALL ON public.pos_menu_categories TO service_role;
ALTER TABLE public.pos_menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcat_read ON public.pos_menu_categories FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY mcat_write ON public.pos_menu_categories FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

CREATE TABLE public.pos_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES public.pos_outlets(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.pos_menu_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_menu_items TO authenticated;
GRANT ALL ON public.pos_menu_items TO service_role;
ALTER TABLE public.pos_menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY mitm_read ON public.pos_menu_items FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY mitm_write ON public.pos_menu_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.pos_menu_items FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ POS TABLES ============
CREATE TABLE public.pos_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES public.pos_outlets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seats INT NOT NULL DEFAULT 2,
  status pos_table_status NOT NULL DEFAULT 'free'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_tables TO authenticated;
GRANT ALL ON public.pos_tables TO service_role;
ALTER TABLE public.pos_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptab_read ON public.pos_tables FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY ptab_admin_write ON public.pos_tables FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], property_id));

-- ============ POS ORDERS ============
CREATE TABLE public.pos_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  outlet_id UUID NOT NULL REFERENCES public.pos_outlets(id) ON DELETE RESTRICT,
  table_id UUID REFERENCES public.pos_tables(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  status pos_order_status NOT NULL DEFAULT 'open',
  guest_name TEXT,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_orders TO authenticated;
GRANT ALL ON public.pos_orders TO service_role;
ALTER TABLE public.pos_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY porders_read ON public.pos_orders FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY porders_write ON public.pos_orders FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], property_id));
CREATE TRIGGER trg_porders_updated BEFORE UPDATE ON public.pos_orders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE OR REPLACE FUNCTION public.gen_pos_order_code() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('ORD'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_porders_code BEFORE INSERT ON public.pos_orders FOR EACH ROW EXECUTE FUNCTION public.gen_pos_order_code();

CREATE TABLE public.pos_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.pos_orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES public.pos_menu_items(id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  price_snapshot NUMERIC(12,2) NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  notes TEXT,
  kot_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_order_items TO authenticated;
GRANT ALL ON public.pos_order_items TO service_role;
ALTER TABLE public.pos_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY poit_read ON public.pos_order_items FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.can_access_property(auth.uid(), o.property_id)));
CREATE POLICY poit_write ON public.pos_order_items FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)));

CREATE TABLE public.pos_kots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.pos_orders(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_by UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_kots TO authenticated;
GRANT ALL ON public.pos_kots TO service_role;
ALTER TABLE public.pos_kots ENABLE ROW LEVEL SECURITY;
CREATE POLICY kot_read ON public.pos_kots FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.can_access_property(auth.uid(), o.property_id)));
CREATE POLICY kot_write ON public.pos_kots FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)));

CREATE TABLE public.pos_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.pos_orders(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  folio_charge_id UUID REFERENCES public.reservation_charges(id) ON DELETE SET NULL,
  received_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_payments TO authenticated;
GRANT ALL ON public.pos_payments TO service_role;
ALTER TABLE public.pos_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppay_read ON public.pos_payments FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.can_access_property(auth.uid(), o.property_id)));
CREATE POLICY ppay_write ON public.pos_payments FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.pos_orders o WHERE o.id=order_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id)));

-- Fire a KOT for all un-fired items on an order
CREATE OR REPLACE FUNCTION public.fire_kot(_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o RECORD; _code TEXT;
BEGIN
  SELECT * INTO o FROM public.pos_orders WHERE id=_order_id;
  IF o IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pos_order_items WHERE order_id=_order_id AND kot_fired_at IS NULL) THEN
    RAISE EXCEPTION 'No new items to fire';
  END IF;
  _code := public.short_code('KOT');
  INSERT INTO public.pos_kots(order_id, code, fired_by) VALUES (_order_id, _code, auth.uid());
  UPDATE public.pos_order_items SET kot_fired_at = now() WHERE order_id=_order_id AND kot_fired_at IS NULL;
  UPDATE public.pos_orders SET status = CASE WHEN status='open' THEN 'sent'::pos_order_status ELSE status END WHERE id=_order_id;
  RETURN _code;
END; $$;

-- Close order: compute totals, deduct stock for linked inventory items,
-- optionally post total to a guest folio and record the payment.
CREATE OR REPLACE FUNCTION public.close_pos_order(_order_id UUID, _method payment_method, _amount NUMERIC, _reference TEXT, _reservation_id UUID, _post_to_folio BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o RECORD; li RECORD; _sub NUMERIC := 0; _tax NUMERIC := 0; _rate NUMERIC := 0; _total NUMERIC; _charge_id UUID; _default_loc UUID;
BEGIN
  SELECT * INTO o FROM public.pos_orders WHERE id=_order_id;
  IF o IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk','cashier']::app_role[], o.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  IF o.status = 'closed' THEN RAISE EXCEPTION 'Order already closed'; END IF;
  SELECT COALESCE(SUM(price_snapshot * quantity),0) INTO _sub FROM public.pos_order_items WHERE order_id=_order_id;
  SELECT tax_rate INTO _rate FROM public.pos_outlets WHERE id=o.outlet_id;
  _tax := ROUND(_sub * COALESCE(_rate,0) / 100, 2);
  _total := _sub + _tax;

  -- Auto stock deduction (from any location tied to outlet; here we simply pick any location for the property)
  SELECT id INTO _default_loc FROM public.stock_locations WHERE property_id=o.property_id ORDER BY created_at LIMIT 1;
  IF _default_loc IS NOT NULL THEN
    FOR li IN
      SELECT mi.inventory_item_id AS item_id, SUM(oi.quantity) AS qty
      FROM public.pos_order_items oi
      JOIN public.pos_menu_items mi ON mi.id = oi.menu_item_id
      WHERE oi.order_id=_order_id AND mi.inventory_item_id IS NOT NULL
      GROUP BY mi.inventory_item_id
    LOOP
      PERFORM public.apply_stock_delta(o.property_id, li.item_id, _default_loc, -li.qty);
    END LOOP;
  END IF;

  IF _post_to_folio THEN
    IF _reservation_id IS NULL THEN RAISE EXCEPTION 'Reservation required to post to folio'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.reservations WHERE id=_reservation_id AND property_id=o.property_id AND status='checked_in') THEN
      RAISE EXCEPTION 'Reservation must be checked in at this property';
    END IF;
    INSERT INTO public.reservation_charges(reservation_id, description, amount, posted_by)
    VALUES (_reservation_id, 'POS ' || o.code, _total, auth.uid())
    RETURNING id INTO _charge_id;
  END IF;

  INSERT INTO public.pos_payments(order_id, method, amount, reference, folio_charge_id, received_by)
  VALUES (_order_id, _method, COALESCE(_amount,_total), _reference, _charge_id, auth.uid());

  UPDATE public.pos_orders
    SET subtotal=_sub, tax=_tax, total=_total, status='closed', closed_at=now(), reservation_id=_reservation_id
    WHERE id=_order_id;
  IF o.table_id IS NOT NULL THEN
    UPDATE public.pos_tables SET status='free' WHERE id=o.table_id;
  END IF;
  RETURN _charge_id;
END; $$;
