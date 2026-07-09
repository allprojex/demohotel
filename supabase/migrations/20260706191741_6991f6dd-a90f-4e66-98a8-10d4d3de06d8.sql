
CREATE TABLE public.esl_pairing_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE,
    suggested_name text,
    kind text NOT NULL CHECK (kind IN (
        'qr_scanner','barcode_scanner','rfid_reader','nfc_reader',
        'esl_gateway','label_printer','handheld_pda','kiosk_camera'
    )),
    connection text NOT NULL CHECK (connection IN (
        'usb','bluetooth','network','serial','webcam','cloud'
    )),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    consumed_at timestamptz,
    device_id uuid REFERENCES public.esl_devices(id) ON DELETE SET NULL,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esl_pairing_codes TO authenticated;
GRANT ALL ON public.esl_pairing_codes TO service_role;
ALTER TABLE public.esl_pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage pairing codes" ON public.esl_pairing_codes
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE POLICY "Users view unexpired pairing codes" ON public.esl_pairing_codes
FOR SELECT TO authenticated
USING (expires_at > now() OR consumed_at IS NOT NULL);
CREATE INDEX idx_esl_pairing_codes_code ON public.esl_pairing_codes(code);
CREATE INDEX idx_esl_pairing_codes_property ON public.esl_pairing_codes(property_id);
CREATE TRIGGER trg_esl_pairing_codes_updated
BEFORE UPDATE ON public.esl_pairing_codes
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Redeem: validates code, creates/attaches device, marks consumed.
CREATE OR REPLACE FUNCTION public.esl_redeem_pairing_code(
    _code text, _name text, _address text, _vendor text, _model text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pc RECORD; _device_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
    SELECT * INTO _pc FROM public.esl_pairing_codes WHERE code = _code FOR UPDATE;
    IF _pc IS NULL THEN RAISE EXCEPTION 'Invalid pairing code'; END IF;
    IF _pc.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Pairing code already used'; END IF;
    IF _pc.expires_at <= now() THEN RAISE EXCEPTION 'Pairing code expired'; END IF;

    INSERT INTO public.esl_devices(
        property_id, name, kind, connection, address, vendor, model, status, last_seen_at
    ) VALUES (
        _pc.property_id,
        COALESCE(NULLIF(_name, ''), _pc.suggested_name, 'Paired device'),
        _pc.kind, _pc.connection,
        NULLIF(_address, ''), NULLIF(_vendor, ''), NULLIF(_model, ''),
        'paired', now()
    ) RETURNING id INTO _device_id;

    UPDATE public.esl_pairing_codes
      SET consumed_at = now(), device_id = _device_id
      WHERE id = _pc.id;

    RETURN _device_id;
END; $$;
REVOKE ALL ON FUNCTION public.esl_redeem_pairing_code(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.esl_redeem_pairing_code(text, text, text, text, text) TO authenticated;

-- Audit purge: super_admin only.
CREATE OR REPLACE FUNCTION public.audit_purge(
    _property_id uuid, _before timestamptz
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
    IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
        RAISE EXCEPTION 'Only super_admin may purge audit records';
    END IF;
    DELETE FROM public.admin_action_logs
      WHERE (_property_id IS NULL OR property_id = _property_id)
        AND (_before IS NULL OR created_at < _before);
    GET DIAGNOSTICS _n = ROW_COUNT;
    RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.audit_purge(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.audit_purge(uuid, timestamptz) TO authenticated;
