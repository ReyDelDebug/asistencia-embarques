-- =====================================================================
-- Migración 002
--  - Área "Lavadoras" (antes WM) y subárea PT dentro de Central
--  - Rol de turno semanal (vigente hasta que el supervisor lo cambie)
--  - Solicitudes de vacaciones / PSG con aprobación
--  - El trabajador crea su propio PIN la primera vez
-- =====================================================================

-- ---------------------------------------------------------------------
-- Áreas y subáreas
-- ---------------------------------------------------------------------
UPDATE departments SET name = 'Lavadoras', report_label = 'LAVADORAS' WHERE code = 'WM';

CREATE TABLE subareas (
  id             SMALLSERIAL PRIMARY KEY,
  department_id  SMALLINT NOT NULL REFERENCES departments(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  report_label   TEXT NOT NULL,
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT subareas_unique UNIQUE (department_id, code)
);

INSERT INTO subareas (department_id, code, name, report_label, sort_order)
SELECT id, 'PT', 'PT', 'PT', 1 FROM departments WHERE code = 'CENTRAL'
ON CONFLICT DO NOTHING;

ALTER TABLE employees ADD COLUMN subarea_id SMALLINT REFERENCES subareas(id);
ALTER TABLE attendance ADD COLUMN subarea_id SMALLINT REFERENCES subareas(id);

-- La subárea debe pertenecer al área del empleado.
CREATE OR REPLACE FUNCTION employees_check_subarea() RETURNS trigger AS $$
BEGIN
  IF NEW.subarea_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM subareas s WHERE s.id = NEW.subarea_id AND s.department_id = NEW.department_id
  ) THEN
    RAISE EXCEPTION 'La subárea no pertenece al área del empleado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employees_subarea_check
  BEFORE INSERT OR UPDATE OF subarea_id, department_id ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_check_subarea();

-- ---------------------------------------------------------------------
-- Rol de turno: cada fila dice "a partir de esta fecha, este empleado va
-- en este turno". Sigue vigente hasta la siguiente asignación.
-- employees.shift_id queda como turno base (antes de cualquier rol).
-- ---------------------------------------------------------------------
CREATE TABLE shift_assignments (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  shift_id        SMALLINT NOT NULL REFERENCES shifts(id),
  effective_from  DATE NOT NULL,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shift_assignments_unique UNIQUE (employee_id, effective_from)
);
CREATE INDEX shift_assignments_lookup ON shift_assignments (employee_id, effective_from DESC);

CREATE OR REPLACE FUNCTION employee_shift_on(p_employee INTEGER, p_date DATE) RETURNS SMALLINT AS $$
  SELECT COALESCE(
    (SELECT sa.shift_id FROM shift_assignments sa
      WHERE sa.employee_id = p_employee AND sa.effective_from <= p_date
      ORDER BY sa.effective_from DESC LIMIT 1),
    (SELECT e.shift_id FROM employees e WHERE e.id = p_employee)
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Solicitudes de vacaciones / PSG
-- ---------------------------------------------------------------------
CREATE TABLE leave_requests (
  id             BIGSERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  type           TEXT NOT NULL CHECK (type IN ('VACACIONES', 'PSG')),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'PENDIENTE'
                 CHECK (status IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     INTEGER REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  CHECK (end_date >= start_date),
  CHECK (end_date - start_date <= 30)
);
CREATE INDEX leave_requests_dates ON leave_requests (start_date, end_date);
CREATE INDEX leave_requests_employee ON leave_requests (employee_id, status);

ALTER TABLE incidents ADD COLUMN leave_request_id BIGINT REFERENCES leave_requests(id);

-- ---------------------------------------------------------------------
-- RLS para las tablas nuevas (sin acceso desde la API pública)
-- ---------------------------------------------------------------------
ALTER TABLE subareas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
  END IF;
END $$;
