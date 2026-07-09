
-- ============ ACCOUNTING PHASE 1 ============

-- 1. Add accountant role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';

-- 2. Currencies
CREATE TABLE public.currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.currencies TO authenticated, anon;
GRANT ALL ON public.currencies TO service_role;
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "currencies readable" ON public.currencies FOR SELECT USING (true);
CREATE POLICY "currencies write super_admin" ON public.currencies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.currencies(code,name,symbol,decimals) VALUES
 ('USD','US Dollar','$',2),('EUR','Euro','€',2),('GBP','British Pound','£',2),
 ('INR','Indian Rupee','₹',2),('AED','UAE Dirham','د.إ',2),('JPY','Japanese Yen','¥',0),
 ('SGD','Singapore Dollar','S$',2),('AUD','Australian Dollar','A$',2),('CAD','Canadian Dollar','C$',2),
 ('CHF','Swiss Franc','CHF',2),('CNY','Chinese Yuan','¥',2),('THB','Thai Baht','฿',2);

-- 3. Base currency on properties
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS base_currency TEXT REFERENCES public.currencies(code) NOT NULL DEFAULT 'USD';

-- 4. FX rates
CREATE TABLE public.fx_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  from_code TEXT NOT NULL REFERENCES public.currencies(code),
  to_code TEXT NOT NULL REFERENCES public.currencies(code),
  rate NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  as_of_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, from_code, to_code, as_of_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fx read" ON public.fx_rates FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "fx write" ON public.fx_rates FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

-- FX helper: get rate for date (nearest prior)
CREATE OR REPLACE FUNCTION public.fx_convert(_property_id UUID, _from TEXT, _to TEXT, _amount NUMERIC, _on_date DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE r NUMERIC;
BEGIN
  IF _from = _to THEN RETURN _amount; END IF;
  SELECT rate INTO r FROM public.fx_rates
    WHERE property_id=_property_id AND from_code=_from AND to_code=_to AND as_of_date <= _on_date
    ORDER BY as_of_date DESC LIMIT 1;
  IF r IS NULL THEN
    -- try inverse
    SELECT 1.0/rate INTO r FROM public.fx_rates
      WHERE property_id=_property_id AND from_code=_to AND to_code=_from AND as_of_date <= _on_date
      ORDER BY as_of_date DESC LIMIT 1;
  END IF;
  IF r IS NULL THEN r := 1; END IF;
  RETURN ROUND(_amount * r, 4);
END; $$;

-- 5. Accounts (Chart of Accounts)
CREATE TYPE public.account_type AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type account_type NOT NULL,
  parent_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  currency TEXT REFERENCES public.currencies(code),
  is_active BOOLEAN NOT NULL DEFAULT true,
  system_key TEXT, -- e.g. 'cash','ar','room_revenue','fnb_revenue','tax_payable','ap','cogs_fnb'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
CREATE UNIQUE INDEX accounts_system_key_prop ON public.accounts(property_id, system_key) WHERE system_key IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acc read" ON public.accounts FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "acc write" ON public.accounts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE TRIGGER accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 6. Accounting periods
CREATE TYPE public.period_status AS ENUM ('open','locked','closed');
CREATE TABLE public.accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status period_status NOT NULL DEFAULT 'open',
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, start_date, end_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_periods TO authenticated;
GRANT ALL ON public.accounting_periods TO service_role;
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "period read" ON public.accounting_periods FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "period write" ON public.accounting_periods FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

-- 7. Tax codes
CREATE TABLE public.tax_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  payable_account_id UUID REFERENCES public.accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_codes TO authenticated;
GRANT ALL ON public.tax_codes TO service_role;
ALTER TABLE public.tax_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax read" ON public.tax_codes FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "tax write" ON public.tax_codes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

-- 8. Journal entries + lines
CREATE TYPE public.journal_source AS ENUM ('manual','folio','pos','ap','ar','payment','night_audit','fx','external_sync');
CREATE TABLE public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  memo TEXT,
  source journal_source NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  currency TEXT NOT NULL REFERENCES public.currencies(code),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID REFERENCES auth.users(id),
  period_id UUID REFERENCES public.accounting_periods(id),
  is_reversal_of UUID REFERENCES public.journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX je_prop_date ON public.journal_entries(property_id, entry_date DESC);
CREATE INDEX je_source_ref ON public.journal_entries(source, source_ref);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT ALL ON public.journal_entries TO service_role;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "je read" ON public.journal_entries FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE POLICY "je insert" ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
-- No update/delete policy: journals are immutable; reverse via new entry.

CREATE TABLE public.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  debit NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency TEXT NOT NULL REFERENCES public.currencies(code),
  fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  debit_base NUMERIC(18,4) NOT NULL DEFAULT 0,
  credit_base NUMERIC(18,4) NOT NULL DEFAULT 0,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX jl_entry ON public.journal_lines(entry_id);
CREATE INDEX jl_account ON public.journal_lines(account_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_lines TO authenticated;
GRANT ALL ON public.journal_lines TO service_role;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jl read" ON public.journal_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.id=entry_id
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], e.property_id)));
CREATE POLICY "jl insert" ON public.journal_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.id=entry_id
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], e.property_id)));

-- 9. post_journal(): validated, balanced, period-aware
CREATE OR REPLACE FUNCTION public.post_journal(
  _property_id UUID, _entry_date DATE, _currency TEXT, _memo TEXT,
  _source journal_source, _source_ref TEXT, _lines JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _entry_id UUID; _prop RECORD; _period_id UUID; _line JSONB;
  _acct_id UUID; _dr NUMERIC; _cr NUMERIC; _dr_b NUMERIC; _cr_b NUMERIC;
  _rate NUMERIC; _sum_dr NUMERIC := 0; _sum_cr NUMERIC := 0;
BEGIN
  SELECT * INTO _prop FROM public.properties WHERE id=_property_id;
  IF _prop IS NULL THEN RAISE EXCEPTION 'Property not found'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RAISE EXCEPTION 'Not permitted to post journal';
  END IF;
  -- Block posting into locked period
  SELECT id INTO _period_id FROM public.accounting_periods
    WHERE property_id=_property_id AND _entry_date BETWEEN start_date AND end_date AND status IN ('locked','closed')
    LIMIT 1;
  IF _period_id IS NOT NULL THEN RAISE EXCEPTION 'Period is locked'; END IF;

  _rate := CASE WHEN _currency=_prop.base_currency THEN 1
                ELSE public.fx_convert(_property_id, _currency, _prop.base_currency, 1, _entry_date) END;

  INSERT INTO public.journal_entries(property_id, entry_date, memo, source, source_ref, currency, posted_by)
  VALUES (_property_id, _entry_date, _memo, _source, _source_ref, _currency, auth.uid())
  RETURNING id INTO _entry_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _acct_id := (_line->>'account_id')::UUID;
    _dr := COALESCE((_line->>'debit')::NUMERIC, 0);
    _cr := COALESCE((_line->>'credit')::NUMERIC, 0);
    _dr_b := ROUND(_dr * _rate, 4);
    _cr_b := ROUND(_cr * _rate, 4);
    INSERT INTO public.journal_lines(entry_id, account_id, debit, credit, currency, fx_rate, debit_base, credit_base, memo)
    VALUES (_entry_id, _acct_id, _dr, _cr, _currency, _rate, _dr_b, _cr_b, _line->>'memo');
    _sum_dr := _sum_dr + _dr_b;
    _sum_cr := _sum_cr + _cr_b;
  END LOOP;

  IF ROUND(_sum_dr,2) <> ROUND(_sum_cr,2) THEN
    RAISE EXCEPTION 'Journal not balanced (DR %, CR %)', _sum_dr, _sum_cr;
  END IF;
  RETURN _entry_id;
END; $$;

-- 10. Seed default chart of accounts for existing + future properties
CREATE OR REPLACE FUNCTION public.seed_default_accounts(_property_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.accounts(property_id, code, name, type, system_key) VALUES
    (_property_id,'1000','Cash','asset','cash'),
    (_property_id,'1010','Bank','asset','bank'),
    (_property_id,'1200','Accounts Receivable','asset','ar'),
    (_property_id,'1400','Inventory','asset','inventory'),
    (_property_id,'2000','Accounts Payable','liability','ap'),
    (_property_id,'2200','Tax Payable','liability','tax_payable'),
    (_property_id,'3000','Owner Equity','equity','equity'),
    (_property_id,'3900','Retained Earnings','equity','retained_earnings'),
    (_property_id,'4000','Room Revenue','revenue','room_revenue'),
    (_property_id,'4100','F&B Revenue','revenue','fnb_revenue'),
    (_property_id,'4200','Other Revenue','revenue','other_revenue'),
    (_property_id,'5000','COGS - F&B','expense','cogs_fnb'),
    (_property_id,'6000','Operating Expenses','expense','opex')
  ON CONFLICT (property_id, code) DO NOTHING;
  -- Default 10% tax code
  INSERT INTO public.tax_codes(property_id, code, name, rate, payable_account_id)
  SELECT _property_id, 'STD','Standard Tax',10,
    (SELECT id FROM public.accounts WHERE property_id=_property_id AND system_key='tax_payable')
  ON CONFLICT (property_id, code) DO NOTHING;
END; $$;

-- Trigger to seed COA on new property
CREATE OR REPLACE FUNCTION public.tg_seed_property_accounts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.seed_default_accounts(NEW.id);
  RETURN NEW;
END; $$;
CREATE TRIGGER seed_accounts_on_property AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.tg_seed_property_accounts();

-- Seed for existing properties
DO $$ DECLARE p RECORD; BEGIN
  FOR p IN SELECT id FROM public.properties LOOP
    PERFORM public.seed_default_accounts(p.id);
  END LOOP;
END $$;

-- 11. Auto-post helpers (safe: EXCEPTION handled so they never break upstream flows)
CREATE OR REPLACE FUNCTION public.post_reservation_checkout(_res_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; _room NUMERIC; _tax NUMERIC := 0; _tax_rate NUMERIC := 0;
        _ar UUID; _rev UUID; _tax_acc UUID; _lines JSONB; _existing UUID;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_res_id;
  IF r IS NULL THEN RETURN NULL; END IF;
  -- Idempotent: skip if already posted
  SELECT id INTO _existing FROM public.journal_entries WHERE source='folio' AND source_ref=_res_id::text LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  SELECT id INTO _ar FROM public.accounts WHERE property_id=r.property_id AND system_key='ar';
  SELECT id INTO _rev FROM public.accounts WHERE property_id=r.property_id AND system_key='room_revenue';
  SELECT id INTO _tax_acc FROM public.accounts WHERE property_id=r.property_id AND system_key='tax_payable';
  SELECT rate INTO _tax_rate FROM public.tax_codes WHERE property_id=r.property_id AND code='STD' LIMIT 1;
  _room := ROUND(COALESCE(r.rate_total,0) / (1 + COALESCE(_tax_rate,0)/100), 4);
  _tax  := ROUND(COALESCE(r.rate_total,0) - _room, 4);
  _lines := jsonb_build_array(
    jsonb_build_object('account_id',_ar,'debit',r.rate_total,'credit',0,'memo','Reservation '||r.code),
    jsonb_build_object('account_id',_rev,'debit',0,'credit',_room,'memo','Room revenue'),
    jsonb_build_object('account_id',_tax_acc,'debit',0,'credit',_tax,'memo','Tax on room')
  );
  RETURN public.post_journal(r.property_id, COALESCE(r.check_out, CURRENT_DATE), 'USD',
    'Folio '||r.code, 'folio', r.id::text, _lines);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'post_reservation_checkout failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.post_pos_order_close(_order_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o RECORD; _cash UUID; _rev UUID; _tax_acc UUID; _lines JSONB; _existing UUID;
BEGIN
  SELECT * INTO o FROM public.pos_orders WHERE id=_order_id;
  IF o IS NULL OR o.status <> 'closed' THEN RETURN NULL; END IF;
  SELECT id INTO _existing FROM public.journal_entries WHERE source='pos' AND source_ref=_order_id::text LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  SELECT id INTO _cash FROM public.accounts WHERE property_id=o.property_id AND system_key='cash';
  SELECT id INTO _rev FROM public.accounts WHERE property_id=o.property_id AND system_key='fnb_revenue';
  SELECT id INTO _tax_acc FROM public.accounts WHERE property_id=o.property_id AND system_key='tax_payable';
  _lines := jsonb_build_array(
    jsonb_build_object('account_id',_cash,'debit',o.total,'credit',0,'memo','POS '||o.code),
    jsonb_build_object('account_id',_rev,'debit',0,'credit',o.subtotal,'memo','F&B revenue'),
    jsonb_build_object('account_id',_tax_acc,'debit',0,'credit',o.tax,'memo','Sales tax')
  );
  RETURN public.post_journal(o.property_id, COALESCE(o.closed_at::date, CURRENT_DATE), 'USD',
    'POS Order '||o.code, 'pos', o.id::text, _lines);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'post_pos_order_close failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.post_payment(_pay_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p RECORD; _cash UUID; _ar UUID; _lines JSONB; _existing UUID; _prop_id UUID;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id=_pay_id;
  IF p IS NULL THEN RETURN NULL; END IF;
  SELECT property_id INTO _prop_id FROM public.reservations WHERE id=p.reservation_id;
  IF _prop_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _existing FROM public.journal_entries WHERE source='payment' AND source_ref=_pay_id::text LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  SELECT id INTO _cash FROM public.accounts WHERE property_id=_prop_id AND system_key='cash';
  SELECT id INTO _ar FROM public.accounts WHERE property_id=_prop_id AND system_key='ar';
  _lines := jsonb_build_array(
    jsonb_build_object('account_id',_cash,'debit',p.amount,'credit',0,'memo','Payment received'),
    jsonb_build_object('account_id',_ar,'debit',0,'credit',p.amount,'memo','Apply to AR')
  );
  RETURN public.post_journal(_prop_id, COALESCE(p.paid_at::date, CURRENT_DATE), 'USD',
    'Payment '||_pay_id::text, 'payment', _pay_id::text, _lines);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'post_payment failed: %', SQLERRM;
  RETURN NULL;
END; $$;

-- Triggers to auto-post
CREATE OR REPLACE FUNCTION public.tg_autopost_reservation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='checked_out' AND (OLD.status IS DISTINCT FROM 'checked_out') THEN
    PERFORM public.post_reservation_checkout(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS autopost_reservation ON public.reservations;
CREATE TRIGGER autopost_reservation AFTER UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopost_reservation();

CREATE OR REPLACE FUNCTION public.tg_autopost_pos() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='closed' AND (OLD.status IS DISTINCT FROM 'closed') THEN
    PERFORM public.post_pos_order_close(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS autopost_pos ON public.pos_orders;
CREATE TRIGGER autopost_pos AFTER UPDATE ON public.pos_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopost_pos();

CREATE OR REPLACE FUNCTION public.tg_autopost_payment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.post_payment(NEW.id);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS autopost_payment ON public.payments;
CREATE TRIGGER autopost_payment AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_autopost_payment();

-- 12. Reporting functions
CREATE OR REPLACE FUNCTION public.report_trial_balance(_property_id UUID, _from DATE, _to DATE)
RETURNS TABLE(account_id UUID, code TEXT, name TEXT, type account_type, debit_total NUMERIC, credit_total NUMERIC, balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT a.id, a.code, a.name, a.type,
         COALESCE(SUM(jl.debit_base),0), COALESCE(SUM(jl.credit_base),0),
         COALESCE(SUM(jl.debit_base - jl.credit_base),0)
  FROM public.accounts a
  LEFT JOIN public.journal_lines jl ON jl.account_id=a.id
  LEFT JOIN public.journal_entries je ON je.id=jl.entry_id AND je.entry_date BETWEEN _from AND _to
  WHERE a.property_id=_property_id AND a.is_active
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id)
  GROUP BY a.id, a.code, a.name, a.type
  ORDER BY a.code;
$$;

CREATE OR REPLACE FUNCTION public.report_profit_loss(_property_id UUID, _from DATE, _to DATE)
RETURNS TABLE(account_id UUID, code TEXT, name TEXT, type account_type, amount NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT a.id, a.code, a.name, a.type,
    CASE WHEN a.type='revenue' THEN COALESCE(SUM(jl.credit_base - jl.debit_base),0)
         ELSE COALESCE(SUM(jl.debit_base - jl.credit_base),0) END
  FROM public.accounts a
  LEFT JOIN public.journal_lines jl ON jl.account_id=a.id
  LEFT JOIN public.journal_entries je ON je.id=jl.entry_id AND je.entry_date BETWEEN _from AND _to
  WHERE a.property_id=_property_id AND a.type IN ('revenue','expense')
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id)
  GROUP BY a.id, a.code, a.name, a.type
  ORDER BY a.type DESC, a.code;
$$;

CREATE OR REPLACE FUNCTION public.report_balance_sheet(_property_id UUID, _as_of DATE)
RETURNS TABLE(account_id UUID, code TEXT, name TEXT, type account_type, balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT a.id, a.code, a.name, a.type,
    CASE WHEN a.type='asset' THEN COALESCE(SUM(jl.debit_base - jl.credit_base),0)
         ELSE COALESCE(SUM(jl.credit_base - jl.debit_base),0) END
  FROM public.accounts a
  LEFT JOIN public.journal_lines jl ON jl.account_id=a.id
  LEFT JOIN public.journal_entries je ON je.id=jl.entry_id AND je.entry_date <= _as_of
  WHERE a.property_id=_property_id AND a.type IN ('asset','liability','equity')
    AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id)
  GROUP BY a.id, a.code, a.name, a.type
  ORDER BY a.type, a.code;
$$;

-- Backfill: post existing checked_out reservations, closed POS orders, and payments
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM public.reservations WHERE status='checked_out' LOOP
    PERFORM public.post_reservation_checkout(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.pos_orders WHERE status='closed' LOOP
    PERFORM public.post_pos_order_close(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.payments LOOP
    PERFORM public.post_payment(r.id);
  END LOOP;
END $$;
