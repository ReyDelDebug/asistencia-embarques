-- =====================================================================
-- Migración 006
--  - Horario: abre 05:00 / 17:00 y cierra 08:00 / 20:00 (último segundo 07:59:59 / 19:59:59)
--  - El supervisor puede cerrar antes o abrir el registro todo el día (por fecha y turno)
--  - Extensión por persona: vale hasta que se cierre o hasta el fin del día
--  - Datos del perfil: teléfono, nacimiento, botas, chaleco
--  - Días de vacaciones asignados por el supervisor
-- =====================================================================

UPDATE shifts SET close_time = '08:00:00' WHERE code = 'DIA';
UPDATE shifts SET close_time = '20:00:00' WHERE code = 'NOCHE';

-- Apertura/cierre manual del supervisor para una fecha y turno.
CREATE TABLE shift_window_overrides (
  operational_date  DATE NOT NULL,
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  open_time         TIME NOT NULL,
  close_time        TIME NOT NULL,
  set_by_user       INTEGER NOT NULL REFERENCES users(id),
  set_by_label      TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operational_date, shift_id),
  CHECK (open_time <= close_time)
);

ALTER TABLE attendance_extensions ADD COLUMN revoked_at TIMESTAMPTZ;
ALTER TABLE attendance_extensions ADD COLUMN revoked_by_label TEXT;

-- Perfil
ALTER TABLE employees ADD COLUMN phone TEXT CHECK (phone ~ '^[0-9]{10}$');
ALTER TABLE employees ADD COLUMN birth_date DATE CHECK (birth_date BETWEEN '1940-01-01' AND '2015-12-31');
ALTER TABLE employees ADD COLUMN boot_size NUMERIC(3,1) CHECK (boot_size BETWEEN 15 AND 40);
ALTER TABLE employees ADD COLUMN vest_size TEXT CHECK (vest_size IN ('CHICO', 'MEDIANO', 'GRANDE'));

-- Vacaciones: días asignados en el periodo y desde cuándo cuenta el periodo.
ALTER TABLE employees ADD COLUMN vacation_days INTEGER CHECK (vacation_days BETWEEN 0 AND 90);
ALTER TABLE employees ADD COLUMN vacation_period_start DATE;

ALTER TABLE shift_window_overrides ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON shift_window_overrides FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON shift_window_overrides FROM authenticated';
  END IF;
END $$;
