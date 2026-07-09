
CREATE TABLE public.file_scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  scanned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT,
  sha256 TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('clean','suspicious','malicious','error','unscanned')),
  heuristics JSONB NOT NULL DEFAULT '{}'::jsonb,
  vt_result JSONB,
  vt_malicious INT DEFAULT 0,
  vt_suspicious INT DEFAULT 0,
  vt_harmless INT DEFAULT 0,
  vt_undetected INT DEFAULT 0,
  reason TEXT,
  quarantined BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.file_scan_logs TO authenticated;
GRANT ALL ON public.file_scan_logs TO service_role;

ALTER TABLE public.file_scan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scan logs for their property"
  ON public.file_scan_logs FOR SELECT TO authenticated
  USING (
    property_id IS NULL
    OR public.has_any_role(auth.uid(),
        ARRAY['super_admin','hotel_owner','general_manager']::app_role[], property_id)
  );

CREATE POLICY "Authenticated users can insert scan logs"
  ON public.file_scan_logs FOR INSERT TO authenticated
  WITH CHECK (
    scanned_by = auth.uid()
    AND (property_id IS NULL OR public.can_access_property(auth.uid(), property_id))
  );

CREATE INDEX idx_file_scan_logs_property_created ON public.file_scan_logs(property_id, created_at DESC);
CREATE INDEX idx_file_scan_logs_verdict ON public.file_scan_logs(verdict);
CREATE INDEX idx_file_scan_logs_sha256 ON public.file_scan_logs(sha256);
