CREATE OR REPLACE FUNCTION public.is_security_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','hotel_owner','general_manager')
  )
$$;
REVOKE ALL ON FUNCTION public.is_security_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_security_admin(uuid) TO authenticated;

-- security_events
CREATE TABLE public.security_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type text NOT NULL CHECK (event_type IN (
        'failed_login','brute_force_detected','account_locked','account_unlocked',
        'session_hijack_attempt','impossible_travel','mfa_disabled','mfa_enabled',
        'password_changed','password_reset_requested','suspicious_ip','policy_violation'
    )),
    severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    ip inet, user_agent text, geo_country text, geo_city text,
    metadata jsonb DEFAULT '{}',
    resolved_at timestamptz,
    resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage security events" ON public.security_events
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE INDEX idx_security_events_property ON public.security_events(property_id);
CREATE INDEX idx_security_events_user ON public.security_events(user_id);
CREATE INDEX idx_security_events_type ON public.security_events(event_type);
CREATE INDEX idx_security_events_created ON public.security_events(created_at DESC);

-- failed_login_attempts
CREATE TABLE public.failed_login_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    ip inet, user_agent text,
    attempted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.failed_login_attempts TO authenticated;
GRANT ALL ON public.failed_login_attempts TO service_role;
ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view failed logins" ON public.failed_login_attempts
FOR SELECT TO authenticated USING (public.is_security_admin(auth.uid()));
CREATE POLICY "Anyone can log failed login" ON public.failed_login_attempts
FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins purge failed logins" ON public.failed_login_attempts
FOR DELETE TO authenticated USING (public.is_security_admin(auth.uid()));
CREATE INDEX idx_failed_login_email ON public.failed_login_attempts(email);
CREATE INDEX idx_failed_login_ip ON public.failed_login_attempts(ip);
CREATE INDEX idx_failed_login_at ON public.failed_login_attempts(attempted_at DESC);

-- account_lockouts
CREATE TABLE public.account_lockouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    email text, ip inet,
    reason text NOT NULL DEFAULT 'brute_force',
    locked_until timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_lockouts TO authenticated;
GRANT ALL ON public.account_lockouts TO service_role;
ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage lockouts" ON public.account_lockouts
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE INDEX idx_lockouts_user ON public.account_lockouts(user_id);
CREATE INDEX idx_lockouts_email ON public.account_lockouts(email);
CREATE INDEX idx_lockouts_ip ON public.account_lockouts(ip);
CREATE INDEX idx_lockouts_until ON public.account_lockouts(locked_until);

-- security_settings
CREATE TABLE public.security_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
    max_failed_attempts int NOT NULL DEFAULT 5,
    lockout_duration_minutes int NOT NULL DEFAULT 30,
    mfa_required boolean NOT NULL DEFAULT false,
    session_max_age_hours int NOT NULL DEFAULT 24,
    allow_concurrent_sessions boolean NOT NULL DEFAULT true,
    notify_on_critical boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_settings TO authenticated;
GRANT ALL ON public.security_settings TO service_role;
ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage security settings" ON public.security_settings
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE TRIGGER trg_security_settings_updated
BEFORE UPDATE ON public.security_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- esl_templates
CREATE TABLE public.esl_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    name text NOT NULL,
    width_mm int NOT NULL DEFAULT 50,
    height_mm int NOT NULL DEFAULT 30,
    layout jsonb NOT NULL DEFAULT '{}',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esl_templates TO authenticated;
GRANT ALL ON public.esl_templates TO service_role;
ALTER TABLE public.esl_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ESL templates" ON public.esl_templates
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE TRIGGER trg_esl_templates_updated
BEFORE UPDATE ON public.esl_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- esl_labels
CREATE TABLE public.esl_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    template_id uuid REFERENCES public.esl_templates(id) ON DELETE SET NULL,
    inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    pos_menu_item_id uuid REFERENCES public.pos_menu_items(id) ON DELETE CASCADE,
    label_code text,
    barcode_type text DEFAULT 'CODE128' CHECK (barcode_type IN ('CODE128','EAN13','UPC-A','QR')),
    custom_text text,
    price_override numeric(12,2),
    last_synced_at timestamptz,
    sync_status text DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','error')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esl_labels TO authenticated;
GRANT ALL ON public.esl_labels TO service_role;
ALTER TABLE public.esl_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ESL labels" ON public.esl_labels
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE INDEX idx_esl_labels_property ON public.esl_labels(property_id);
CREATE INDEX idx_esl_labels_template ON public.esl_labels(template_id);
CREATE TRIGGER trg_esl_labels_updated
BEFORE UPDATE ON public.esl_labels
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- esl_sync_batches
CREATE TABLE public.esl_sync_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    label_count int NOT NULL DEFAULT 0,
    format text NOT NULL DEFAULT 'csv' CHECK (format IN ('csv','json','xml')),
    file_url text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.esl_sync_batches TO authenticated;
GRANT ALL ON public.esl_sync_batches TO service_role;
ALTER TABLE public.esl_sync_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage sync batches" ON public.esl_sync_batches
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));

-- printers
CREATE TABLE public.printers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('webusb','webbluetooth','webserial','printnode','network')),
    model text,
    protocol text DEFAULT 'escpos' CHECK (protocol IN ('escpos','zpl','raw','pdf')),
    config jsonb DEFAULT '{}',
    printnode_id text,
    is_default boolean NOT NULL DEFAULT false,
    last_seen_at timestamptz,
    status text DEFAULT 'offline' CHECK (status IN ('online','offline','error')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.printers TO authenticated;
GRANT ALL ON public.printers TO service_role;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage printers" ON public.printers
FOR ALL TO authenticated
USING (public.is_security_admin(auth.uid()))
WITH CHECK (public.is_security_admin(auth.uid()));
CREATE POLICY "All users view printers" ON public.printers
FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_printers_property ON public.printers(property_id);
CREATE UNIQUE INDEX idx_printers_default_per_property
ON public.printers(property_id) WHERE is_default = true;
CREATE TRIGGER trg_printers_updated
BEFORE UPDATE ON public.printers
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- print_jobs
CREATE TABLE public.print_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    job_type text NOT NULL CHECK (job_type IN (
        'receipt','invoice','label','barcode','report','document','kot','bill'
    )),
    title text,
    content bytea,
    content_url text,
    copies int NOT NULL DEFAULT 1,
    priority int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
    error text,
    metadata jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.print_jobs TO authenticated;
GRANT ALL ON public.print_jobs TO service_role;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own print jobs" ON public.print_jobs
FOR ALL TO authenticated
USING (created_by = auth.uid() OR public.is_security_admin(auth.uid()))
WITH CHECK (created_by = auth.uid() OR public.is_security_admin(auth.uid()));
CREATE INDEX idx_print_jobs_property ON public.print_jobs(property_id);
CREATE INDEX idx_print_jobs_printer ON public.print_jobs(printer_id);
CREATE INDEX idx_print_jobs_status ON public.print_jobs(status);
CREATE INDEX idx_print_jobs_created ON public.print_jobs(created_at DESC);