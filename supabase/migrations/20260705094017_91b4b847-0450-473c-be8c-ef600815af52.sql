
CREATE OR REPLACE FUNCTION public.exec_analytics_kpis(
  _property_id uuid, _from date, _to date
) RETURNS TABLE (
  revenue numeric, room_revenue numeric, pos_revenue numeric,
  nights_sold bigint, room_count bigint, days bigint,
  occupancy_pct numeric, adr numeric, revpar numeric,
  reservations_count bigint, cancelled_count bigint, cancellation_rate numeric,
  avg_los numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
      ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH
  d AS (SELECT GREATEST(1, (_to - _from + 1))::bigint AS days),
  rc AS (SELECT COUNT(*)::bigint AS c FROM rooms WHERE property_id = _property_id),
  active_res AS (
    SELECT check_in, check_out, rate_total
    FROM reservations
    WHERE property_id = _property_id
      AND status NOT IN ('cancelled','no_show')
      AND check_in <= _to AND check_out > _from
  ),
  nights AS (
    SELECT
      COALESCE(SUM(GREATEST(0, LEAST(check_out, (_to+1))::date - GREATEST(check_in, _from)::date)),0)::bigint AS n,
      COALESCE(SUM(rate_total),0)::numeric AS rev,
      COALESCE(AVG(check_out - check_in),0)::numeric AS los
    FROM active_res
  ),
  allres AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE status IN ('cancelled','no_show'))::bigint AS cancelled
    FROM reservations
    WHERE property_id = _property_id AND created_at::date BETWEEN _from AND _to
  ),
  pos AS (
    SELECT COALESCE(SUM(total),0)::numeric AS rev
    FROM pos_orders WHERE property_id = _property_id
      AND status <> 'void' AND created_at::date BETWEEN _from AND _to
  )
  SELECT
    (nights.rev + pos.rev),
    nights.rev, pos.rev, nights.n, rc.c, d.days,
    CASE WHEN rc.c * d.days = 0 THEN 0 ELSE ROUND(nights.n::numeric / (rc.c * d.days) * 100, 2) END,
    CASE WHEN nights.n = 0 THEN 0 ELSE ROUND(nights.rev / nights.n, 2) END,
    CASE WHEN rc.c * d.days = 0 THEN 0 ELSE ROUND(nights.rev / (rc.c * d.days), 2) END,
    allres.total, allres.cancelled,
    CASE WHEN allres.total = 0 THEN 0 ELSE ROUND(allres.cancelled::numeric / allres.total * 100, 2) END,
    ROUND(nights.los, 2)
  FROM d, rc, nights, allres, pos;
END;
$$;

CREATE OR REPLACE FUNCTION public.exec_analytics_revenue_by_day(
  _property_id uuid, _from date, _to date
) RETURNS TABLE (day date, room_revenue numeric, pos_revenue numeric, total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
      ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH series AS (SELECT generate_series(_from, _to, interval '1 day')::date AS d),
  rooms_daily AS (
    SELECT s.d, COALESCE(SUM(
      CASE WHEN (r.check_out - r.check_in) = 0 THEN 0
           ELSE r.rate_total / (r.check_out - r.check_in) END
    ), 0)::numeric AS rev
    FROM series s
    LEFT JOIN reservations r ON r.property_id = _property_id
      AND r.status NOT IN ('cancelled','no_show')
      AND s.d >= r.check_in AND s.d < r.check_out
    GROUP BY s.d
  ),
  pos_daily AS (
    SELECT s.d, COALESCE(SUM(o.total), 0)::numeric AS rev
    FROM series s
    LEFT JOIN pos_orders o ON o.property_id = _property_id
      AND o.status <> 'void' AND o.created_at::date = s.d
    GROUP BY s.d
  )
  SELECT r.d, r.rev, p.rev, (r.rev + p.rev)
  FROM rooms_daily r JOIN pos_daily p USING (d) ORDER BY r.d;
END;
$$;

CREATE OR REPLACE FUNCTION public.exec_analytics_revenue_by_source(
  _property_id uuid, _from date, _to date
) RETURNS TABLE (source text, reservations bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
      ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT COALESCE(r.source, 'direct') AS source,
         COUNT(*)::bigint,
         COALESCE(SUM(r.rate_total),0)::numeric
  FROM reservations r
  WHERE r.property_id = _property_id
    AND r.status NOT IN ('cancelled','no_show')
    AND r.check_in <= _to AND r.check_out > _from
  GROUP BY COALESCE(r.source, 'direct')
  ORDER BY 3 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.exec_analytics_top_room_types(
  _property_id uuid, _from date, _to date
) RETURNS TABLE (room_type text, nights bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(),
      ARRAY['super_admin','hotel_owner','general_manager','accountant']::app_role[], _property_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT rt.name,
    COALESCE(SUM(GREATEST(0, LEAST(r.check_out, (_to+1))::date - GREATEST(r.check_in, _from)::date)),0)::bigint,
    COALESCE(SUM(r.rate_total),0)::numeric
  FROM reservations r
  JOIN room_types rt ON rt.id = r.room_type_id
  WHERE r.property_id = _property_id
    AND r.status NOT IN ('cancelled','no_show')
    AND r.check_in <= _to AND r.check_out > _from
  GROUP BY rt.name ORDER BY 3 DESC LIMIT 10;
END;
$$;
