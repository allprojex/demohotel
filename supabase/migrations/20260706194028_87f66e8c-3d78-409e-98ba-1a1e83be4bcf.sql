
-- Scope reads to caller's property, drop universal-read policies
DROP POLICY IF EXISTS "All users view ESL devices" ON public.esl_devices;
CREATE POLICY "Property members view ESL devices" ON public.esl_devices
  FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "Users view unexpired pairing codes" ON public.esl_pairing_codes;
CREATE POLICY "Property members view pairing codes" ON public.esl_pairing_codes
  FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "All users read routing rules" ON public.printer_routing_rules;
CREATE POLICY "Property members read routing rules" ON public.printer_routing_rules
  FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "All users view printers" ON public.printers;
CREATE POLICY "Property members view printers" ON public.printers
  FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));

-- Prevent authenticated users from injecting arbitrary failed-login rows.
-- The service_role bypasses RLS, so trusted server code can still write.
DROP POLICY IF EXISTS "Anyone can log failed login" ON public.failed_login_attempts;
