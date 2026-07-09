
-- recycle_bin: universal soft-delete store
CREATE TABLE public.recycle_bin (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
    source_table text NOT NULL,
    source_id text NOT NULL,
    label text,
    snapshot jsonb NOT NULL,
    deleted_by uuid,
    deleted_at timestamptz NOT NULL DEFAULT now(),
    restored_at timestamptz,
    purged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recycle_bin TO authenticated;
GRANT ALL ON public.recycle_bin TO service_role;
ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage recycle bin" ON public.recycle_bin
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE INDEX idx_recycle_bin_property ON public.recycle_bin(property_id);
CREATE INDEX idx_recycle_bin_source ON public.recycle_bin(source_table, source_id);
CREATE INDEX idx_recycle_bin_deleted_at ON public.recycle_bin(deleted_at DESC);
CREATE TRIGGER trg_recycle_bin_updated
BEFORE UPDATE ON public.recycle_bin
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- esl_devices: scannable and label peripherals
CREATE TABLE public.esl_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN (
        'qr_scanner','barcode_scanner','rfid_reader','nfc_reader',
        'esl_gateway','label_printer','handheld_pda','kiosk_camera'
    )),
    connection text NOT NULL CHECK (connection IN (
        'usb','bluetooth','network','serial','webcam','cloud'
    )),
    address text,
    vendor text,
    model text,
    status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','error','paired')),
    last_seen_at timestamptz,
    notes text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esl_devices TO authenticated;
GRANT ALL ON public.esl_devices TO service_role;
ALTER TABLE public.esl_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ESL devices" ON public.esl_devices
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE POLICY "All users view ESL devices" ON public.esl_devices
FOR SELECT TO authenticated
USING (true);
CREATE INDEX idx_esl_devices_property ON public.esl_devices(property_id);
CREATE INDEX idx_esl_devices_kind ON public.esl_devices(kind);
CREATE TRIGGER trg_esl_devices_updated
BEFORE UPDATE ON public.esl_devices
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
