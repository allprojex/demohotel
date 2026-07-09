
CREATE TYPE public.channel_type AS ENUM ('booking_com','expedia','airbnb');
CREATE TYPE public.channel_sync_status AS ENUM ('idle','syncing','success','failed');
CREATE TYPE public.channel_sync_direction AS ENUM ('push_ari','pull_reservations');
CREATE TYPE public.channel_queue_status AS ENUM ('pending','imported','failed','ignored');

CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  type channel_type NOT NULL DEFAULT 'booking_com',
  name text NOT NULL,
  external_hotel_id text,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status channel_sync_status NOT NULL DEFAULT 'idle',
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_read" ON public.channels FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "channels_write" ON public.channels FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));
CREATE TRIGGER channels_updated BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.channel_room_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  external_room_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, room_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_room_mappings TO authenticated;
GRANT ALL ON public.channel_room_mappings TO service_role;
ALTER TABLE public.channel_room_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_read" ON public.channel_room_mappings FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.can_access_property(auth.uid(),c.property_id)));
CREATE POLICY "crm_write" ON public.channel_room_mappings FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], c.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], c.property_id)));

CREATE TABLE public.channel_rate_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  rate_plan_id uuid NOT NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
  external_rate_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, rate_plan_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_rate_mappings TO authenticated;
GRANT ALL ON public.channel_rate_mappings TO service_role;
ALTER TABLE public.channel_rate_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crtm_read" ON public.channel_rate_mappings FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.can_access_property(auth.uid(),c.property_id)));
CREATE POLICY "crtm_write" ON public.channel_rate_mappings FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], c.property_id)))
  WITH CHECK (EXISTS(SELECT 1 FROM public.channels c WHERE c.id=channel_id AND public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], c.property_id)));

CREATE TABLE public.channel_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  direction channel_sync_direction NOT NULL,
  status channel_sync_status NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_csl_channel_time ON public.channel_sync_logs(channel_id, created_at DESC);
GRANT SELECT, INSERT ON public.channel_sync_logs TO authenticated;
GRANT ALL ON public.channel_sync_logs TO service_role;
ALTER TABLE public.channel_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csl_read" ON public.channel_sync_logs FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "csl_insert" ON public.channel_sync_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_sync_logs;
ALTER TABLE public.channel_sync_logs REPLICA IDENTITY FULL;

CREATE TABLE public.channel_reservations_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  status channel_queue_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (channel_id, external_ref)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_reservations_queue TO authenticated;
GRANT ALL ON public.channel_reservations_queue TO service_role;
ALTER TABLE public.channel_reservations_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crq_read" ON public.channel_reservations_queue FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "crq_write" ON public.channel_reservations_queue FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk']::app_role[], property_id));

ALTER TABLE public.reservations
  ADD COLUMN external_ref text,
  ADD COLUMN confirmation_code text UNIQUE,
  ADD COLUMN confirmation_email text;

UPDATE public.reservations SET confirmation_code = 'BK-' || upper(substr(md5(id::text),1,8)) WHERE confirmation_code IS NULL;

ALTER TABLE public.properties ADD COLUMN is_public boolean NOT NULL DEFAULT true;
ALTER TABLE public.properties ADD COLUMN slug text UNIQUE;
UPDATE public.properties SET slug = lower(regexp_replace(code, '[^a-zA-Z0-9]+','-','g'));
ALTER TABLE public.room_types ADD COLUMN is_public boolean NOT NULL DEFAULT true;

GRANT SELECT ON public.properties TO anon;
GRANT SELECT ON public.room_types TO anon;
GRANT SELECT ON public.rate_plans TO anon;

CREATE POLICY "properties_public_read" ON public.properties FOR SELECT TO anon
  USING (is_public = true AND active = true);
CREATE POLICY "room_types_public_read" ON public.room_types FOR SELECT TO anon
  USING (is_public = true AND EXISTS(SELECT 1 FROM public.properties p WHERE p.id=property_id AND p.is_public AND p.active));
CREATE POLICY "rate_plans_public_read" ON public.rate_plans FOR SELECT TO anon
  USING (EXISTS(SELECT 1 FROM public.room_types rt WHERE rt.id=room_type_id AND rt.is_public));

CREATE OR REPLACE FUNCTION public.booking_search_availability(
  _property_id uuid, _check_in date, _check_out date, _guests integer DEFAULT 1
) RETURNS TABLE (
  room_type_id uuid, room_type_name text, description text, max_occupancy integer,
  base_rate numeric, best_rate numeric, amenities jsonb, available_rooms integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH types AS (
    SELECT rt.* FROM public.room_types rt
    JOIN public.properties p ON p.id = rt.property_id
    WHERE rt.property_id = _property_id AND rt.is_public AND p.is_public AND p.active
      AND rt.max_occupancy >= _guests
  ),
  total_rooms AS (
    SELECT r.room_type_id, COUNT(*)::int AS total
    FROM public.rooms r WHERE r.property_id = _property_id
    GROUP BY r.room_type_id
  ),
  booked AS (
    SELECT room_type_id, COUNT(*)::int AS booked
    FROM public.reservations
    WHERE property_id = _property_id
      AND status IN ('confirmed','checked_in')
      AND NOT (check_out <= _check_in OR check_in >= _check_out)
    GROUP BY room_type_id
  ),
  best AS (
    SELECT rp.room_type_id, MIN(rp.rate) AS best_rate
    FROM public.rate_plans rp
    WHERE rp.property_id = _property_id
      AND rp.start_date <= _check_in AND rp.end_date >= _check_out
    GROUP BY rp.room_type_id
  )
  SELECT t.id, t.name, t.description, t.max_occupancy, t.base_rate,
    COALESCE(b.best_rate, t.base_rate) AS best_rate,
    t.amenities,
    GREATEST(COALESCE(tr.total,0) - COALESCE(bk.booked,0), 0) AS available_rooms
  FROM types t
  LEFT JOIN total_rooms tr ON tr.room_type_id = t.id
  LEFT JOIN booked bk ON bk.room_type_id = t.id
  LEFT JOIN best b ON b.room_type_id = t.id
  WHERE COALESCE(tr.total,0) - COALESCE(bk.booked,0) > 0
  ORDER BY best_rate NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.booking_search_availability(uuid,date,date,integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_create(
  _property_id uuid, _room_type_id uuid, _check_in date, _check_out date,
  _adults integer, _children integer,
  _first_name text, _last_name text, _email text, _phone text,
  _address text, _source text DEFAULT 'direct', _external_ref text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS TABLE (reservation_id uuid, confirmation_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _guest_id uuid; _res_id uuid; _code text; _confirm text;
  _avail integer; _rate numeric;
BEGIN
  IF _check_out <= _check_in THEN RAISE EXCEPTION 'Invalid dates'; END IF;
  IF _email IS NULL OR _email = '' THEN RAISE EXCEPTION 'Email required'; END IF;

  SELECT available_rooms, best_rate INTO _avail, _rate
  FROM public.booking_search_availability(_property_id, _check_in, _check_out, GREATEST(_adults,1))
  WHERE room_type_id = _room_type_id;
  IF _avail IS NULL OR _avail < 1 THEN RAISE EXCEPTION 'Room type not available for selected dates'; END IF;

  SELECT id INTO _guest_id FROM public.guests
    WHERE property_id = _property_id AND lower(email) = lower(_email) LIMIT 1;
  IF _guest_id IS NULL THEN
    INSERT INTO public.guests(property_id, first_name, last_name, email, phone, address)
    VALUES (_property_id, _first_name, _last_name, _email, _phone, _address)
    RETURNING id INTO _guest_id;
  END IF;

  _code := 'RES-' || to_char(now(),'YYMMDD') || '-' || upper(substr(md5(random()::text),1,5));
  _confirm := 'BK-' || upper(substr(md5(random()::text || _email),1,8));

  INSERT INTO public.reservations(
    property_id, code, guest_id, room_type_id, check_in, check_out,
    adults, children, status, source, external_ref, rate_total,
    confirmation_code, confirmation_email, notes
  ) VALUES (
    _property_id, _code, _guest_id, _room_type_id, _check_in, _check_out,
    _adults, _children, 'confirmed', _source, _external_ref,
    _rate * (_check_out - _check_in), _confirm, lower(_email), _notes
  ) RETURNING id INTO _res_id;

  reservation_id := _res_id; confirmation_code := _confirm; RETURN NEXT;
END; $$;
GRANT EXECUTE ON FUNCTION public.booking_create(uuid,uuid,date,date,integer,integer,text,text,text,text,text,text,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_lookup(_confirmation_code text, _email text)
RETURNS TABLE (
  id uuid, code text, confirmation_code text, property_id uuid, property_name text,
  room_type_id uuid, room_type_name text, check_in date, check_out date,
  adults integer, children integer, status reservation_status, rate_total numeric,
  guest_first_name text, guest_last_name text, guest_email text, guest_phone text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.code, r.confirmation_code, r.property_id, p.name,
         r.room_type_id, rt.name, r.check_in, r.check_out, r.adults, r.children,
         r.status, r.rate_total,
         g.first_name, g.last_name, g.email, g.phone
  FROM public.reservations r
  JOIN public.properties p ON p.id = r.property_id
  JOIN public.room_types rt ON rt.id = r.room_type_id
  JOIN public.guests g ON g.id = r.guest_id
  WHERE r.confirmation_code = _confirmation_code
    AND lower(r.confirmation_email) = lower(_email)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.booking_lookup(text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_modify(
  _confirmation_code text, _email text,
  _check_in date, _check_out date, _adults integer, _children integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; _avail integer; _rate numeric;
BEGIN
  SELECT * INTO r FROM public.reservations
    WHERE confirmation_code = _confirmation_code AND lower(confirmation_email) = lower(_email);
  IF r IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF r.status NOT IN ('confirmed') THEN RAISE EXCEPTION 'Booking cannot be modified in status %', r.status; END IF;
  IF _check_out <= _check_in THEN RAISE EXCEPTION 'Invalid dates'; END IF;

  WITH total_rooms AS (
    SELECT COUNT(*)::int AS total FROM public.rooms
    WHERE property_id = r.property_id AND room_type_id = r.room_type_id
  ),
  booked AS (
    SELECT COUNT(*)::int AS booked FROM public.reservations
    WHERE property_id = r.property_id AND room_type_id = r.room_type_id
      AND status IN ('confirmed','checked_in') AND id != r.id
      AND NOT (check_out <= _check_in OR check_in >= _check_out)
  )
  SELECT GREATEST(t.total - b.booked, 0) INTO _avail FROM total_rooms t, booked b;
  IF COALESCE(_avail,0) < 1 THEN RAISE EXCEPTION 'No availability for new dates'; END IF;

  SELECT MIN(rate) INTO _rate FROM public.rate_plans
    WHERE room_type_id = r.room_type_id AND start_date <= _check_in AND end_date >= _check_out;

  UPDATE public.reservations
    SET check_in=_check_in, check_out=_check_out, adults=_adults, children=_children,
        rate_total = COALESCE(_rate, (r.rate_total / GREATEST((r.check_out - r.check_in),1))) * (_check_out - _check_in),
        updated_at = now()
    WHERE id = r.id;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.booking_modify(text,text,date,date,integer,integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_cancel(_confirmation_code text, _email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.reservations
    WHERE confirmation_code=_confirmation_code AND lower(confirmation_email)=lower(_email);
  IF r IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF r.status = 'checked_in' OR r.status = 'checked_out' THEN RAISE EXCEPTION 'Cannot cancel a % booking', r.status; END IF;
  UPDATE public.reservations SET status='cancelled', updated_at=now() WHERE id=r.id;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.booking_cancel(text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.channel_import_queue(_queue_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q RECORD; _rt_id uuid; _guest_id uuid; _res_id uuid; _code text; _confirm text;
        _ci date; _co date; _adults int; _children int; _fn text; _ln text; _em text; _ph text;
BEGIN
  SELECT * INTO q FROM public.channel_reservations_queue WHERE id=_queue_id;
  IF q IS NULL THEN RAISE EXCEPTION 'Queue item not found'; END IF;
  IF q.status <> 'pending' THEN RAISE EXCEPTION 'Already processed'; END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','hotel_owner','general_manager','front_desk']::app_role[], q.property_id) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  _ci := (q.payload->>'check_in')::date;
  _co := (q.payload->>'check_out')::date;
  _adults := COALESCE((q.payload->>'adults')::int, 1);
  _children := COALESCE((q.payload->>'children')::int, 0);
  _fn := q.payload->>'first_name'; _ln := q.payload->>'last_name';
  _em := q.payload->>'email'; _ph := q.payload->>'phone';

  SELECT room_type_id INTO _rt_id FROM public.channel_room_mappings
    WHERE channel_id = q.channel_id AND external_room_code = COALESCE(q.payload->>'external_room_code','') LIMIT 1;
  IF _rt_id IS NULL THEN
    SELECT id INTO _rt_id FROM public.room_types WHERE property_id = q.property_id AND is_public ORDER BY base_rate LIMIT 1;
  END IF;
  IF _rt_id IS NULL THEN RAISE EXCEPTION 'No room type available'; END IF;

  SELECT id INTO _guest_id FROM public.guests WHERE property_id=q.property_id AND lower(email)=lower(_em) LIMIT 1;
  IF _guest_id IS NULL THEN
    INSERT INTO public.guests(property_id, first_name, last_name, email, phone)
    VALUES (q.property_id, COALESCE(_fn,'OTA'), COALESCE(_ln,'Guest'), _em, _ph)
    RETURNING id INTO _guest_id;
  END IF;

  _code := 'RES-' || to_char(now(),'YYMMDD') || '-' || upper(substr(md5(random()::text),1,5));
  _confirm := 'BK-' || upper(substr(md5(random()::text || q.external_ref),1,8));

  INSERT INTO public.reservations(
    property_id, code, guest_id, room_type_id, check_in, check_out,
    adults, children, status, source, external_ref, rate_total,
    confirmation_code, confirmation_email
  ) VALUES (
    q.property_id, _code, _guest_id, _rt_id, _ci, _co, _adults, _children,
    'confirmed', 'ota_booking_com', q.external_ref,
    COALESCE((q.payload->>'total')::numeric, 0), _confirm, lower(COALESCE(_em,''))
  ) RETURNING id INTO _res_id;

  UPDATE public.channel_reservations_queue
    SET status='imported', reservation_id=_res_id, processed_at=now()
    WHERE id=_queue_id;
  RETURN _res_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.channel_import_queue(uuid) TO authenticated;
