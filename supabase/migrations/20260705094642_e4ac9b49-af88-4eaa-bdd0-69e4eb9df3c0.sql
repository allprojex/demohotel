-- Ensure a generic updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.analytics_export_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  format TEXT NOT NULL DEFAULT 'both' CHECK (format IN ('csv','pdf','both')),
  recipients TEXT[] NOT NULL DEFAULT '{}',
  hour INTEGER NOT NULL DEFAULT 6 CHECK (hour BETWEEN 0 AND 23),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 28),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_error TEXT,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_export_schedules TO authenticated;
GRANT ALL ON public.analytics_export_schedules TO service_role;
ALTER TABLE public.analytics_export_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exec roles read schedules"
  ON public.analytics_export_schedules FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE POLICY "exec roles write schedules"
  ON public.analytics_export_schedules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

CREATE TRIGGER trg_analytics_export_schedules_updated
  BEFORE UPDATE ON public.analytics_export_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.analytics_export_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.analytics_export_schedules(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  format TEXT NOT NULL,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  csv_payload TEXT,
  html_report TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_export_runs TO authenticated;
GRANT ALL ON public.analytics_export_runs TO service_role;
ALTER TABLE public.analytics_export_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exec roles read runs"
  ON public.analytics_export_runs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));
CREATE POLICY "exec roles write runs"
  ON public.analytics_export_runs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id))
  WITH CHECK (public.has_any_role(auth.uid(),
    ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], property_id));

ALTER TABLE public.accounting_sync_runs
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
