
-- ============ POSTING RULES ============
CREATE TABLE public.posting_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,           -- e.g. folio_ar, folio_room_revenue, folio_tax, pos_cash, pos_revenue, pos_tax, pos_cogs, payment_cash, refund_cash, ap_expense, ap_liability, ar_revenue, ar_receivable
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, rule_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posting_rules TO authenticated;
GRANT ALL ON public.posting_rules TO service_role;
ALTER TABLE public.posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posting_rules read" ON public.posting_rules FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "posting_rules write" ON public.posting_rules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE TRIGGER trg_posting_rules_updated BEFORE UPDATE ON public.posting_rules FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_account(_property_id UUID, _rule_key TEXT, _fallback_system_key TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(
    (SELECT account_id FROM public.posting_rules WHERE property_id=_property_id AND rule_key=_rule_key),
    (SELECT id FROM public.accounts WHERE property_id=_property_id AND system_key=_fallback_system_key LIMIT 1)
  );
$$;

-- ============ AR INVOICES (company/OTA/travel-agent invoicing) ============
CREATE TYPE ar_status AS ENUM ('draft','sent','paid','void');
CREATE TABLE public.ar_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  bill_to_name TEXT NOT NULL,
  bill_to_email TEXT,
  bill_to_address TEXT,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax NUMERIC(18,4) NOT NULL DEFAULT 0,
  total NUMERIC(18,4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18,4) NOT NULL DEFAULT 0,
  status ar_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  posted_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_invoices TO authenticated;
GRANT ALL ON public.ar_invoices TO service_role;
ALTER TABLE public.ar_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ar_invoices read" ON public.ar_invoices FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "ar_invoices write" ON public.ar_invoices FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant','front_desk']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant','front_desk']::app_role[], property_id));
CREATE TRIGGER trg_ar_invoices_updated BEFORE UPDATE ON public.ar_invoices FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ar_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.ar_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  revenue_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_invoice_lines TO authenticated;
GRANT ALL ON public.ar_invoice_lines TO service_role;
ALTER TABLE public.ar_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ar_invoice_lines rw" ON public.ar_invoice_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ar_invoices i WHERE i.id=invoice_id AND public.can_access_property(auth.uid(), i.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ar_invoices i WHERE i.id=invoice_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant','front_desk']::app_role[], i.property_id)));

CREATE OR REPLACE FUNCTION public.gen_ar_code() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('INV'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_ar_code BEFORE INSERT ON public.ar_invoices FOR EACH ROW EXECUTE FUNCTION public.gen_ar_code();

CREATE OR REPLACE FUNCTION public.post_ar_invoice(_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  inv RECORD; ln RECORD; _lines JSONB := '[]'::jsonb;
  _sub NUMERIC := 0; _tax NUMERIC := 0; _total NUMERIC := 0;
  _ar UUID; _tax_acc UUID; _rev UUID; _entry UUID;
BEGIN
  SELECT * INTO inv FROM public.ar_invoices WHERE id=_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.posted_entry_id IS NOT NULL THEN RETURN inv.posted_entry_id; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], inv.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  _ar := public.resolve_account(inv.property_id,'ar_receivable','ar');
  _tax_acc := public.resolve_account(inv.property_id,'ar_tax','tax_payable');
  FOR ln IN SELECT * FROM public.ar_invoice_lines WHERE invoice_id=_id LOOP
    _sub := _sub + (ln.quantity * ln.unit_price);
    _tax := _tax + ROUND((ln.quantity * ln.unit_price) * ln.tax_rate / 100, 4);
    _rev := COALESCE(ln.revenue_account_id, public.resolve_account(inv.property_id,'ar_revenue','other_revenue'));
    _lines := _lines || jsonb_build_array(jsonb_build_object('account_id',_rev,'debit',0,'credit',ln.quantity*ln.unit_price,'memo',ln.description));
  END LOOP;
  _total := _sub + _tax;
  _lines := jsonb_build_array(jsonb_build_object('account_id',_ar,'debit',_total,'credit',0,'memo','AR '||inv.code)) || _lines;
  IF _tax > 0 THEN
    _lines := _lines || jsonb_build_array(jsonb_build_object('account_id',_tax_acc,'debit',0,'credit',_tax,'memo','Tax on '||inv.code));
  END IF;
  _entry := public.post_journal(inv.property_id, inv.issue_date, inv.currency, 'AR Invoice '||inv.code, 'ar', inv.id::text, _lines);
  UPDATE public.ar_invoices SET subtotal=_sub, tax=_tax, total=_total, status='sent', posted_entry_id=_entry WHERE id=_id;
  RETURN _entry;
END; $$;

-- ============ AP BILLS ============
CREATE TYPE ap_status AS ENUM ('draft','open','paid','void');
CREATE TABLE public.ap_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax NUMERIC(18,4) NOT NULL DEFAULT 0,
  total NUMERIC(18,4) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(18,4) NOT NULL DEFAULT 0,
  status ap_status NOT NULL DEFAULT 'draft',
  reference TEXT,
  notes TEXT,
  posted_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_bills TO authenticated;
GRANT ALL ON public.ap_bills TO service_role;
ALTER TABLE public.ap_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ap_bills read" ON public.ap_bills FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "ap_bills write" ON public.ap_bills FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE TRIGGER trg_ap_bills_updated BEFORE UPDATE ON public.ap_bills FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ap_bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.ap_bills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  expense_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_bill_lines TO authenticated;
GRANT ALL ON public.ap_bill_lines TO service_role;
ALTER TABLE public.ap_bill_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ap_bill_lines rw" ON public.ap_bill_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ap_bills b WHERE b.id=bill_id AND public.can_access_property(auth.uid(), b.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ap_bills b WHERE b.id=bill_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], b.property_id)));

CREATE OR REPLACE FUNCTION public.gen_ap_code() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.code IS NULL OR NEW.code='' THEN NEW.code := public.short_code('BILL'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_ap_code BEFORE INSERT ON public.ap_bills FOR EACH ROW EXECUTE FUNCTION public.gen_ap_code();

CREATE OR REPLACE FUNCTION public.post_ap_bill(_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  b RECORD; ln RECORD; _lines JSONB := '[]'::jsonb;
  _sub NUMERIC := 0; _tax NUMERIC := 0; _total NUMERIC := 0;
  _ap UUID; _tax_acc UUID; _exp UUID; _entry UUID;
BEGIN
  SELECT * INTO b FROM public.ap_bills WHERE id=_id;
  IF b IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF b.posted_entry_id IS NOT NULL THEN RETURN b.posted_entry_id; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], b.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  _ap := public.resolve_account(b.property_id,'ap_liability','ap');
  _tax_acc := public.resolve_account(b.property_id,'ap_tax','tax_payable');
  FOR ln IN SELECT * FROM public.ap_bill_lines WHERE bill_id=_id LOOP
    _sub := _sub + (ln.quantity * ln.unit_price);
    _tax := _tax + ROUND((ln.quantity * ln.unit_price) * ln.tax_rate / 100, 4);
    _exp := COALESCE(ln.expense_account_id, public.resolve_account(b.property_id,'ap_expense','opex'));
    _lines := _lines || jsonb_build_array(jsonb_build_object('account_id',_exp,'debit',ln.quantity*ln.unit_price,'credit',0,'memo',ln.description));
  END LOOP;
  _total := _sub + _tax;
  IF _tax > 0 THEN
    _lines := _lines || jsonb_build_array(jsonb_build_object('account_id',_tax_acc,'debit',_tax,'credit',0,'memo','Tax on '||b.code));
  END IF;
  _lines := _lines || jsonb_build_array(jsonb_build_object('account_id',_ap,'debit',0,'credit',_total,'memo','AP '||b.code));
  _entry := public.post_journal(b.property_id, b.bill_date, b.currency, 'AP Bill '||b.code, 'ap', b.id::text, _lines);
  UPDATE public.ap_bills SET subtotal=_sub, tax=_tax, total=_total, status='open', posted_entry_id=_entry WHERE id=_id;
  RETURN _entry;
END; $$;

-- ============ AP PAYMENTS ============
CREATE TABLE public.ap_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES public.ap_bills(id) ON DELETE CASCADE,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount NUMERIC(18,4) NOT NULL,
  method payment_method NOT NULL DEFAULT 'cash',
  reference TEXT,
  posted_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_payments TO authenticated;
GRANT ALL ON public.ap_payments TO service_role;
ALTER TABLE public.ap_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ap_payments read" ON public.ap_payments FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "ap_payments write" ON public.ap_payments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

CREATE OR REPLACE FUNCTION public.post_ap_payment(_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p RECORD; b RECORD; _cash UUID; _ap UUID; _lines JSONB; _entry UUID; _cur TEXT;
BEGIN
  SELECT * INTO p FROM public.ap_payments WHERE id=_id;
  IF p IS NULL THEN RETURN NULL; END IF;
  IF p.posted_entry_id IS NOT NULL THEN RETURN p.posted_entry_id; END IF;
  SELECT * INTO b FROM public.ap_bills WHERE id=p.bill_id;
  _cash := public.resolve_account(p.property_id, CASE WHEN p.method='cash' THEN 'payment_cash' ELSE 'payment_bank' END,
                                  CASE WHEN p.method='cash' THEN 'cash' ELSE 'bank' END);
  _ap := public.resolve_account(p.property_id,'ap_liability','ap');
  _cur := COALESCE(b.currency,'USD');
  _lines := jsonb_build_array(
    jsonb_build_object('account_id',_ap,'debit',p.amount,'credit',0,'memo','AP payment '||b.code),
    jsonb_build_object('account_id',_cash,'debit',0,'credit',p.amount,'memo','Cash out')
  );
  _entry := public.post_journal(p.property_id, p.paid_at::date, _cur, 'AP Payment '||b.code, 'ap_payment', p.id::text, _lines);
  UPDATE public.ap_payments SET posted_entry_id=_entry WHERE id=_id;
  UPDATE public.ap_bills SET amount_paid = amount_paid + p.amount,
    status = CASE WHEN amount_paid + p.amount >= total THEN 'paid'::ap_status ELSE status END
    WHERE id=p.bill_id;
  RETURN _entry;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_autopost_ap_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.post_ap_payment(NEW.id); RETURN NEW; END; $$;
CREATE TRIGGER trg_ap_payment_autopost AFTER INSERT ON public.ap_payments FOR EACH ROW EXECUTE FUNCTION public.tg_autopost_ap_payment();

-- ============ REFUNDS: extend existing payments handling ============
-- Existing post_payment handles amount; allow negative amount for refunds via same trigger.
-- Add a helper view for aging.
CREATE OR REPLACE VIEW public.ar_aging AS
SELECT i.property_id, i.id, i.code, i.bill_to_name, i.due_date, i.total, i.amount_paid,
  (i.total - i.amount_paid) AS balance,
  GREATEST(0, (CURRENT_DATE - i.due_date))::int AS days_overdue,
  CASE
    WHEN i.total - i.amount_paid <= 0 THEN 'paid'
    WHEN CURRENT_DATE <= i.due_date THEN 'current'
    WHEN CURRENT_DATE - i.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket
FROM public.ar_invoices i WHERE i.status <> 'void';
GRANT SELECT ON public.ar_aging TO authenticated;

CREATE OR REPLACE VIEW public.ap_aging AS
SELECT b.property_id, b.id, b.code, b.supplier_name, b.due_date, b.total, b.amount_paid,
  (b.total - b.amount_paid) AS balance,
  GREATEST(0, (CURRENT_DATE - b.due_date))::int AS days_overdue,
  CASE
    WHEN b.total - b.amount_paid <= 0 THEN 'paid'
    WHEN CURRENT_DATE <= b.due_date THEN 'current'
    WHEN CURRENT_DATE - b.due_date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - b.due_date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - b.due_date <= 90 THEN '61-90'
    ELSE '90+'
  END AS bucket
FROM public.ap_bills b WHERE b.status <> 'void';
GRANT SELECT ON public.ap_aging TO authenticated;

-- ============ NIGHT AUDIT ============
CREATE TYPE night_audit_status AS ENUM ('pending','completed','failed');
CREATE TABLE public.night_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  status night_audit_status NOT NULL DEFAULT 'pending',
  rooms_occupied INT NOT NULL DEFAULT 0,
  arrivals INT NOT NULL DEFAULT 0,
  departures INT NOT NULL DEFAULT 0,
  no_shows INT NOT NULL DEFAULT 0,
  reservations_posted INT NOT NULL DEFAULT 0,
  pos_orders_posted INT NOT NULL DEFAULT 0,
  payments_posted INT NOT NULL DEFAULT 0,
  room_revenue NUMERIC(18,4) NOT NULL DEFAULT 0,
  fnb_revenue NUMERIC(18,4) NOT NULL DEFAULT 0,
  tax_collected NUMERIC(18,4) NOT NULL DEFAULT 0,
  cash_in NUMERIC(18,4) NOT NULL DEFAULT 0,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  period_locked BOOLEAN NOT NULL DEFAULT false,
  ran_by UUID REFERENCES auth.users(id),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, business_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_audits TO authenticated;
GRANT ALL ON public.night_audits TO service_role;
ALTER TABLE public.night_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "night_audits read" ON public.night_audits FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "night_audits write" ON public.night_audits FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

CREATE OR REPLACE FUNCTION public.run_night_audit(_property_id UUID, _business_date DATE, _lock_period BOOLEAN DEFAULT false)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _audit_id UUID; r RECORD; _warn JSONB := '[]'::jsonb; _err JSONB := '[]'::jsonb;
  _res_posted INT := 0; _pos_posted INT := 0; _pay_posted INT := 0;
  _rooms_occ INT; _arr INT; _dep INT; _noshow INT;
  _room_rev NUMERIC := 0; _fnb_rev NUMERIC := 0; _tax NUMERIC := 0; _cash NUMERIC := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  -- Auto check-out overdue reservations still checked_in with check_out <= business_date
  FOR r IN SELECT id FROM public.reservations
    WHERE property_id=_property_id AND status='checked_in' AND check_out <= _business_date LOOP
    BEGIN
      UPDATE public.reservations SET status='checked_out', updated_at=now() WHERE id=r.id;
      _res_posted := _res_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      _err := _err || jsonb_build_array(jsonb_build_object('type','reservation_checkout','id',r.id,'error',SQLERRM));
    END;
  END LOOP;

  -- Mark no-shows: confirmed reservations with check_in < business_date and never checked in
  FOR r IN SELECT id FROM public.reservations
    WHERE property_id=_property_id AND status='confirmed' AND check_in < _business_date LOOP
    UPDATE public.reservations SET status='no_show', updated_at=now() WHERE id=r.id;
    _warn := _warn || jsonb_build_array(jsonb_build_object('type','no_show','reservation_id',r.id));
  END LOOP;

  -- Warn on open POS orders
  FOR r IN SELECT id, code FROM public.pos_orders
    WHERE property_id=_property_id AND status IN ('open','sent') AND opened_at::date <= _business_date LOOP
    _warn := _warn || jsonb_build_array(jsonb_build_object('type','open_pos_order','order_id',r.id,'code',r.code));
  END LOOP;

  -- Metrics
  SELECT COUNT(*) INTO _rooms_occ FROM public.reservations
    WHERE property_id=_property_id AND status='checked_in'
      AND check_in <= _business_date AND check_out > _business_date;
  SELECT COUNT(*) INTO _arr FROM public.reservations
    WHERE property_id=_property_id AND check_in=_business_date AND status IN ('checked_in','checked_out');
  SELECT COUNT(*) INTO _dep FROM public.reservations
    WHERE property_id=_property_id AND check_out=_business_date AND status='checked_out';
  SELECT COUNT(*) INTO _noshow FROM public.reservations
    WHERE property_id=_property_id AND status='no_show' AND check_in=_business_date;

  SELECT COALESCE(SUM(jl.credit_base - jl.debit_base),0) INTO _room_rev
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id=jl.entry_id
    JOIN public.accounts a ON a.id=jl.account_id
    WHERE je.property_id=_property_id AND je.entry_date=_business_date AND a.system_key='room_revenue';
  SELECT COALESCE(SUM(jl.credit_base - jl.debit_base),0) INTO _fnb_rev
    FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.entry_id
    JOIN public.accounts a ON a.id=jl.account_id
    WHERE je.property_id=_property_id AND je.entry_date=_business_date AND a.system_key='fnb_revenue';
  SELECT COALESCE(SUM(jl.credit_base - jl.debit_base),0) INTO _tax
    FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.entry_id
    JOIN public.accounts a ON a.id=jl.account_id
    WHERE je.property_id=_property_id AND je.entry_date=_business_date AND a.system_key='tax_payable';
  SELECT COALESCE(SUM(jl.debit_base - jl.credit_base),0) INTO _cash
    FROM public.journal_lines jl JOIN public.journal_entries je ON je.id=jl.entry_id
    JOIN public.accounts a ON a.id=jl.account_id
    WHERE je.property_id=_property_id AND je.entry_date=_business_date AND a.system_key IN ('cash','bank');

  SELECT COUNT(*) INTO _pos_posted FROM public.journal_entries
    WHERE property_id=_property_id AND entry_date=_business_date AND source='pos';
  SELECT COUNT(*) INTO _pay_posted FROM public.journal_entries
    WHERE property_id=_property_id AND entry_date=_business_date AND source='payment';

  INSERT INTO public.night_audits(
    property_id, business_date, status, rooms_occupied, arrivals, departures, no_shows,
    reservations_posted, pos_orders_posted, payments_posted,
    room_revenue, fnb_revenue, tax_collected, cash_in,
    warnings, errors, period_locked, ran_by
  ) VALUES (
    _property_id, _business_date,
    CASE WHEN jsonb_array_length(_err) > 0 THEN 'failed' ELSE 'completed' END,
    _rooms_occ, _arr, _dep, _noshow, _res_posted, _pos_posted, _pay_posted,
    _room_rev, _fnb_rev, _tax, _cash, _warn, _err, false, auth.uid()
  )
  ON CONFLICT (property_id, business_date) DO UPDATE SET
    status=EXCLUDED.status, rooms_occupied=EXCLUDED.rooms_occupied,
    arrivals=EXCLUDED.arrivals, departures=EXCLUDED.departures, no_shows=EXCLUDED.no_shows,
    reservations_posted=EXCLUDED.reservations_posted, pos_orders_posted=EXCLUDED.pos_orders_posted,
    payments_posted=EXCLUDED.payments_posted, room_revenue=EXCLUDED.room_revenue,
    fnb_revenue=EXCLUDED.fnb_revenue, tax_collected=EXCLUDED.tax_collected, cash_in=EXCLUDED.cash_in,
    warnings=EXCLUDED.warnings, errors=EXCLUDED.errors, ran_at=now(), ran_by=auth.uid()
  RETURNING id INTO _audit_id;

  IF _lock_period AND jsonb_array_length(_err) = 0 THEN
    INSERT INTO public.accounting_periods(property_id, start_date, end_date, status, locked_at, locked_by)
    VALUES (_property_id, _business_date, _business_date, 'locked', now(), auth.uid())
    ON CONFLICT DO NOTHING;
    UPDATE public.night_audits SET period_locked=true WHERE id=_audit_id;
  END IF;

  RETURN _audit_id;
END; $$;
