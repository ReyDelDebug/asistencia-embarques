-- =====================================================================
-- CONTROL DE ASISTENCIA – EMBARQUES
-- Migración 001: esquema inicial
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------
CREATE TABLE shifts (
  id            SMALLSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE CHECK (code IN ('DIA', 'NOCHE')),
  name          TEXT NOT NULL,
  -- Ventana de registro en hora local (America/Mexico_City).
  -- open_time es inclusivo, close_time es EXCLUSIVO (07:40:00 ya está bloqueado).
  open_time     TIME NOT NULL,
  close_time    TIME NOT NULL,
  report_title  TEXT NOT NULL,
  sort_order    SMALLINT NOT NULL DEFAULT 0,
  CHECK (open_time < close_time)
);

-- ---------------------------------------------------------------------
-- Áreas
-- ---------------------------------------------------------------------
CREATE TABLE departments (
  id            SMALLSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  report_label  TEXT NOT NULL,
  sort_order    SMALLINT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Empleados (plantilla)
-- role: EMPLOYEE | LEADER | SUPERVISOR
-- Un SUPERVISOR no pertenece a un área, pero sí a un turno.
-- ---------------------------------------------------------------------
CREATE TABLE employees (
  id               SERIAL PRIMARY KEY,
  employee_number  TEXT NOT NULL UNIQUE CHECK (employee_number ~ '^[0-9]{3,10}$'),
  full_name        TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  role             TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (role IN ('EMPLOYEE', 'LEADER', 'SUPERVISOR')),
  department_id    SMALLINT REFERENCES departments(id),
  shift_id         SMALLINT NOT NULL REFERENCES shifts(id),
  pin_hash         TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  terminated_at    DATE,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  seed_key         TEXT UNIQUE,  -- identificador estable para la carga inicial idempotente
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'SUPERVISOR') = (department_id IS NULL))
);
CREATE INDEX employees_shift_dept_idx ON employees (shift_id, department_id) WHERE active;

-- ---------------------------------------------------------------------
-- Usuarios del panel administrativo
-- role: ADMIN | SUPERVISOR
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
  display_name     TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'SUPERVISOR' CHECK (role IN ('ADMIN', 'SUPERVISOR')),
  employee_id      INTEGER UNIQUE REFERENCES employees(id),
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Asistencia confirmada por el empleado.
-- confirmed_at = hora del servidor, NUNCA se modifica.
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  department_id     SMALLINT REFERENCES departments(id),   -- área al momento del registro
  role              TEXT NOT NULL,                          -- rol al momento del registro
  operational_date  DATE NOT NULL,
  confirmed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip                TEXT,
  user_agent        TEXT,
  CONSTRAINT attendance_unique_per_day UNIQUE (employee_id, operational_date, shift_id)
);
CREATE INDEX attendance_date_shift_idx ON attendance (operational_date, shift_id);

-- La hora de confirmación es inmutable: se bloquean UPDATE y DELETE.
CREATE OR REPLACE FUNCTION attendance_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de asistencia no pueden modificarse ni eliminarse';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_no_update
  BEFORE UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION attendance_immutable();

-- ---------------------------------------------------------------------
-- Incidencias (estado manual asignado por el supervisor)
-- Nunca se borran: se revocan (revoked_at) para conservar historial.
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  operational_date  DATE NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('FALTA', 'VACACIONES', 'INCAPACIDAD', 'PSG', 'BAJA')),
  reason            TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  revoked_by        INTEGER REFERENCES users(id),
  revoke_reason     TEXT
);
CREATE UNIQUE INDEX incidents_one_active
  ON incidents (employee_id, operational_date, shift_id) WHERE revoked_at IS NULL;
CREATE INDEX incidents_date_shift_idx ON incidents (operational_date, shift_id);

-- ---------------------------------------------------------------------
-- Datos operativos del reporte (vacantes, recoge, notas)
-- ---------------------------------------------------------------------
CREATE TABLE operational_reports (
  id                BIGSERIAL PRIMARY KEY,
  operational_date  DATE NOT NULL,
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  vacantes          TEXT NOT NULL DEFAULT '',
  recoge            TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  last_generated_text TEXT,
  updated_by        INTEGER REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operational_reports_unique UNIQUE (operational_date, shift_id)
);

-- Personal adicional por concepto operativo (DESCARGA, BANDA, ELEVADOR, ...)
-- No son empleados de la plantilla: solo cantidades con concepto.
CREATE TABLE operational_extras (
  id                BIGSERIAL PRIMARY KEY,
  report_id         BIGINT NOT NULL REFERENCES operational_reports(id) ON DELETE CASCADE,
  concept           TEXT NOT NULL CHECK (length(trim(concept)) > 0),
  quantity          INTEGER NOT NULL CHECK (quantity >= 0 AND quantity <= 500),
  notes             TEXT NOT NULL DEFAULT '',
  add_to_total      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX operational_extras_report_idx ON operational_extras (report_id);

-- ---------------------------------------------------------------------
-- Sesiones (token aleatorio; en BD solo se guarda su hash SHA-256)
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id            BIGSERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('EMPLOYEE', 'USER')),
  subject_id    INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX sessions_subject_idx ON sessions (subject_type, subject_id);

-- ---------------------------------------------------------------------
-- Intentos de inicio de sesión (limitación por IP)
-- ---------------------------------------------------------------------
CREATE TABLE login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  scope       TEXT NOT NULL,       -- 'EMPLOYEE' | 'USER'
  ip          TEXT NOT NULL,
  identifier  TEXT,
  success     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON login_attempts (scope, ip, created_at);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('USER', 'EMPLOYEE', 'SYSTEM', 'ANONYMOUS')),
  actor_id     INTEGER,
  actor_label  TEXT,
  action       TEXT NOT NULL,
  entity       TEXT,
  entity_id    TEXT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de auditoría no puede modificarse';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- ---------------------------------------------------------------------
-- Seguridad para Supabase / PostgREST:
-- Se activa RLS en TODAS las tablas SIN políticas para los roles
-- anon/authenticated. Así la API pública de Supabase no puede leer ni
-- escribir nada; solo el backend (conexión directa con el rol dueño
-- de las tablas) tiene acceso.
-- ---------------------------------------------------------------------
ALTER TABLE shifts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_extras   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
