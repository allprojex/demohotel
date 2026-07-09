
CREATE TABLE IF NOT EXISTS public.backup_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  property_id UUID NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('system','property')),
  kind TEXT NOT NULL CHECK (kind IN ('full','incremental')) DEFAULT 'full',
  frequency TEXT NOT NULL CHECK (frequency IN ('hourly','daily','weekly','monthly')) DEFAULT 'daily',
  hour_utc INT NOT NULL DEFAULT 2 CHECK (hour_utc BETWEEN 0 AND 23),
  day_of_week INT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month INT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  tables TEXT[] NULL,
  retention_count INT NOT NULL DEFAULT 14 CHECK (retention_count BETWEEN 1 AND 365),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ NULL,
  last_snapshot_id UUID NULL,
  next_run_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_schedules TO authenticated;
GRANT ALL ON public.backup_schedules TO service_role;

ALTER TABLE public.backup_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage backup schedules"
ON public.backup_schedules FOR ALL
TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_backup_schedules_updated
BEFORE UPDATE ON public.backup_schedules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NULL REFERENCES public.backup_schedules(id) ON DELETE SET NULL,
  property_id UUID NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('system','property')),
  kind TEXT NOT NULL CHECK (kind IN ('full','incremental','manual')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')) DEFAULT 'running',
  storage_path TEXT NULL,
  size_bytes BIGINT NULL,
  row_count BIGINT NULL,
  table_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  since_at TIMESTAMPTZ NULL,
  until_at TIMESTAMPTZ NULL,
  duration_ms INT NULL,
  error TEXT NULL,
  triggered_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_snapshots TO authenticated;
GRANT ALL ON public.backup_snapshots TO service_role;

ALTER TABLE public.backup_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read backup snapshots"
ON public.backup_snapshots FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "Super admins write backup snapshots"
ON public.backup_snapshots FOR ALL
TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_schedule ON public.backup_snapshots(schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created ON public.backup_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_schedules_next ON public.backup_schedules(next_run_at) WHERE enabled;
