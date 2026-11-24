-- =====================================================================
-- Migración 007
--  - Calendario laboral (solo se guardan los días que el supervisor cambia;
--    el resto se calcula: L–J laborable, viernes tiempo extra, sábado,
--    domingo y feriados de ley no laborables)
--  - Cambio de área en el rol: cada asignación puede llevar área/subárea
--    y una fecha de regreso (apoyo temporal)
-- =====================================================================

CREATE TABLE work_calendar (
  day           DATE PRIMARY KEY,
  day_type      TEXT NOT NULL CHECK (day_type IN ('LABORAL', 'VIERNES', 'VIERNES_LARGO', 'NO_LABORAL', 'FERIADO')),
  label         TEXT NOT NULL DEFAULT '',
  set_by        INTEGER REFERENCES users(id),
  set_by_label  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shift_assignments ADD COLUMN department_id SMALLINT REFERENCES departments(id);
ALTER TABLE shift_assignments ADD COLUMN subarea_id SMALLINT REFERENCES subareas(id);
ALTER TABLE shift_assignments ADD COLUMN end_date DATE;
ALTER TABLE shift_assignments ADD CONSTRAINT shift_assignments_end_check CHECK (end_date IS NULL OR end_date >= effective_from);

-- Turno vigente: la asignación más reciente que ya empezó y no ha terminado.
CREATE OR REPLACE FUNCTION employee_shift_on(p_employee INTEGER, p_date DATE) RETURNS SMALLINT AS $$
  SELECT COALESCE(
    (SELECT sa.shift_id FROM shift_assignments sa
      WHERE sa.employee_id = p_employee AND sa.effective_from <= p_date
        AND (sa.end_date IS NULL OR sa.end_date >= p_date)
      ORDER BY sa.effective_from DESC, sa.id DESC LIMIT 1),
    (SELECT e.shift_id FROM employees e WHERE e.id = p_employee)
  );
$$ LANGUAGE sql STABLE;

-- Ubicación completa en una fecha: turno, área, subárea y si es apoyo temporal.
CREATE OR REPLACE FUNCTION employee_placement_on(p_employee INTEGER, p_date DATE)
RETURNS TABLE (shift_id SMALLINT, department_id SMALLINT, subarea_id SMALLINT, is_temporary BOOLEAN, until_date DATE) AS $$
  SELECT COALESCE(a.shift_id, e.shift_id),
         COALESCE(a.department_id, e.department_id),
         CASE WHEN a.department_id IS NOT NULL THEN a.subarea_id ELSE e.subarea_id END,
         COALESCE(a.end_date IS NOT NULL AND a.department_id IS NOT NULL, FALSE),
         a.end_date
  FROM employees e
  LEFT JOIN LATERAL (
    SELECT * FROM shift_assignments sa
    WHERE sa.employee_id = e.id AND sa.effective_from <= p_date AND (sa.end_date IS NULL OR sa.end_date >= p_date)
    ORDER BY sa.effective_from DESC, sa.id DESC LIMIT 1
  ) a ON TRUE
  WHERE e.id = p_employee;
$$ LANGUAGE sql STABLE;

ALTER TABLE work_calendar ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON work_calendar FROM anon';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON work_calendar FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
  END IF;
END $$;
