
-- 1. Fix role functions: NULL property_id no longer wildcards unless the row is super_admin
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role, _property_id uuid DEFAULT NULL::uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND (
      ur.role = 'super_admin'
      OR (ur.role = _role AND (_property_id IS NULL OR ur.property_id = _property_id))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[], _property_id uuid DEFAULT NULL::uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND (
      ur.role = 'super_admin'
      OR (ur.role = ANY(_roles) AND (_property_id IS NULL OR ur.property_id = _property_id))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND (
      ur.role = 'super_admin'
      OR ur.property_id = _property_id
    )
  )
$$;

-- 2. Enforce that only super_admin rows may have NULL property_id, and only
-- existing super_admins may grant super_admin (bootstrap trigger still handles first).
CREATE OR REPLACE FUNCTION public.enforce_user_role_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _caller uuid := auth.uid(); _caller_is_super boolean;
BEGIN
  IF NEW.role <> 'super_admin' AND NEW.property_id IS NULL THEN
    RAISE EXCEPTION 'Non-super_admin roles must be scoped to a property';
  END IF;
  IF _caller IS NULL THEN
    -- background / trigger context (e.g. bootstrap_super_admin) — allow
    RETURN NEW;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_caller AND role='super_admin')
    INTO _caller_is_super;
  IF NEW.role = 'super_admin' AND NOT _caller_is_super THEN
    RAISE EXCEPTION 'Only super_admin may grant super_admin';
  END IF;
  IF NEW.property_id IS NULL AND NOT _caller_is_super THEN
    RAISE EXCEPTION 'Only super_admin may create global (unscoped) role assignments';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_user_role_scope ON public.user_roles;
CREATE TRIGGER trg_enforce_user_role_scope
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_user_role_scope();

-- Clean up any pre-existing invalid rows (non-super_admin with NULL property_id)
DELETE FROM public.user_roles WHERE role <> 'super_admin' AND property_id IS NULL;

-- 3. Tighten channels SELECT to manager roles only (hide credentials from staff)
DROP POLICY IF EXISTS channels_read ON public.channels;
CREATE POLICY channels_read ON public.channels FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

-- 4. Revoke broad EXECUTE on SECURITY DEFINER functions; grant only the safe callable set.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.proname, r.args);
  END LOOP;
END $$;

-- Public booking flow (anon + authenticated)
GRANT EXECUTE ON FUNCTION public.booking_search_availability(uuid,date,date,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_create(uuid,uuid,date,date,integer,integer,text,text,text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_lookup(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_cancel(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_modify(text,text,date,date,integer,integer) TO anon, authenticated;

-- Authenticated-only RPCs the app calls directly
GRANT EXECUTE ON FUNCTION public.has_role(uuid,app_role,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,app_role[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_property(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_adjustment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_pos_order(uuid,payment_method,numeric,text,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fire_kot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.channel_import_queue(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_night_audit(uuid,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_trial_balance(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_profit_loss(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_balance_sheet(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_ar_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_ap_bill(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fx_convert(uuid,text,text,numeric,date) TO authenticated;
