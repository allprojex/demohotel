
CREATE TABLE public.admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','print','other')),
  before_snapshot JSONB,
  after_snapshot JSONB,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_action_logs TO authenticated;
GRANT ALL ON public.admin_action_logs TO service_role;

ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view logs for their properties"
  ON public.admin_action_logs FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['super_admin','hotel_owner','general_manager']::app_role[],
      property_id
    )
  );

CREATE INDEX idx_admin_logs_property_created ON public.admin_action_logs(property_id, created_at DESC);
CREATE INDEX idx_admin_logs_entity ON public.admin_action_logs(entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.admin_log(
  _property_id UUID,
  _entity_type TEXT,
  _entity_id TEXT,
  _action TEXT,
  _before JSONB,
  _after JSONB,
  _memo TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF NOT public.has_any_role(auth.uid(),
        ARRAY['super_admin','hotel_owner','general_manager']::app_role[], _property_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.admin_action_logs(
    property_id, actor_id, entity_type, entity_id, action, before_snapshot, after_snapshot, memo
  ) VALUES (
    _property_id, auth.uid(), _entity_type, _entity_id, _action, _before, _after, _memo
  ) RETURNING id INTO _id;
  RETURN _id;
END;
$$;
