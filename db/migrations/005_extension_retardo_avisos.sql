-- =====================================================================
-- Migración 005
--  - Extensión del registro hasta las 7:30 autorizada por supervisor o líder
--  - Aviso "Llegaré tarde" (motivo obligatorio) y registro al llegar
--  - Suscripciones a notificaciones push y control de recordatorios enviados
-- =====================================================================

-- Límites por turno:
--   extension_close: hasta cuándo vale una extensión (exclusivo) → 07:30 / 19:30
--   late_limit:      hasta cuándo puede registrar quien avisó retardo → 11:20 / 23:20
ALTER TABLE shifts ADD COLUMN extension_close TIME;
ALTER TABLE shifts ADD COLUMN late_limit TIME;
UPDATE shifts SET extension_close = '07:30:00', late_limit = '11:20:00' WHERE code = 'DIA';
UPDATE shifts SET extension_close = '19:30:00', late_limit = '23:20:00' WHERE code = 'NOCHE';

-- Cómo se hizo cada registro de asistencia.
ALTER TABLE attendance ADD COLUMN via TEXT NOT NULL DEFAULT 'NORMAL'
  CHECK (via IN ('NORMAL', 'EXTENSION', 'LATE_NOTICE'));

-- ---------------------------------------------------------------------
-- Extensiones de registro
-- ---------------------------------------------------------------------
CREATE TABLE attendance_extensions (
  id                    BIGSERIAL PRIMARY KEY,
  employee_id           INTEGER NOT NULL REFERENCES employees(id),
  shift_id              SMALLINT NOT NULL REFERENCES shifts(id),
  operational_date      DATE NOT NULL,
  close_time            TIME NOT NULL,
  granted_by_user       INTEGER REFERENCES users(id),
  granted_by_employee   INTEGER REFERENCES employees(id),   -- líder
  granted_by_label      TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_extensions_unique UNIQUE (employee_id, operational_date, shift_id),
  CHECK ((granted_by_user IS NULL) <> (granted_by_employee IS NULL))
);
CREATE INDEX attendance_extensions_date ON attendance_extensions (operational_date, shift_id);

-- ---------------------------------------------------------------------
-- Avisos de retardo
-- ---------------------------------------------------------------------
CREATE TABLE late_notices (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  operational_date  DATE NOT NULL,
  eta               TIME NOT NULL,
  reason            TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT late_notices_unique UNIQUE (employee_id, operational_date, shift_id)
);
CREATE INDEX late_notices_date ON late_notices (operational_date, shift_id);

-- ---------------------------------------------------------------------
-- Notificaciones push
-- ---------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id               BIGSERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at  TIMESTAMPTZ,
  failures         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_employee ON push_subscriptions (employee_id);

-- Evita mandar el mismo recordatorio dos veces.
CREATE TABLE push_reminders_sent (
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  operational_date  DATE NOT NULL,
  shift_id          SMALLINT NOT NULL REFERENCES shifts(id),
  kind              TEXT NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, operational_date, shift_id, kind)
);

ALTER TABLE attendance_extensions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE late_notices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_reminders_sent    ENABLE ROW LEVEL SECURITY;

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
