-- =====================================================================
-- Migración 004
--  - Nuevo horario: el registro cierra a las 07:20 (día) y 19:20 (noche).
--    Último segundo válido: 07:19:59 / 19:19:59.
--  - Fotos de perfil de los empleados (guardadas en la base de datos,
--    ya redimensionadas en el celular: máximo ~300 KB).
-- =====================================================================

UPDATE shifts SET close_time = '07:20:00' WHERE code = 'DIA';
UPDATE shifts SET close_time = '19:20:00' WHERE code = 'NOCHE';

CREATE TABLE employee_photos (
  employee_id   INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data          BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 100 AND 307200),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employee_photos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON employee_photos FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON employee_photos FROM authenticated';
  END IF;
END $$;
