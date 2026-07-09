
CREATE TABLE public.printer_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('receipt','invoice','label','barcode','report','document','kot','bill')),
  printer_id uuid NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, job_type, priority)
);

CREATE INDEX idx_printer_routing_lookup ON public.printer_routing_rules (property_id, job_type, is_active, priority);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.printer_routing_rules TO authenticated;
GRANT ALL ON public.printer_routing_rules TO service_role;

ALTER TABLE public.printer_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All users read routing rules" ON public.printer_routing_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage routing rules" ON public.printer_routing_rules
  FOR ALL TO authenticated
  USING (public.is_security_admin(auth.uid()))
  WITH CHECK (public.is_security_admin(auth.uid()));

CREATE TRIGGER trg_printer_routing_updated
  BEFORE UPDATE ON public.printer_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
