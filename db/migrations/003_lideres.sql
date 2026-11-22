-- =====================================================================
-- Migración 003: líderes por área
--   Central: Isaías Romero (día), Javier Ángeles (noche)
--   PT (subárea de Central): Manuel Cruz
--   RC: Gerardo Marroquín (día), Gerardo González (noche)
--   Lavadoras: Jonathan Cruz
-- Solo afecta a empleados creados por la carga inicial (seed_key) y que
-- sigan en su área original; en una base nueva no hace nada (el seed ya
-- los crea como líderes).
-- =====================================================================

UPDATE employees SET role = 'LEADER', updated_at = now()
WHERE seed_key IN (
  'DIA-CENTRAL-isaias-romero',
  'NOCHE-CENTRAL-javier-angeles',
  'DIA-RC-gerardo-marroquin',
  'NOCHE-RC-gerardo-gonzalez',
  'DIA-WM-jonathan-cruz'
) AND role = 'EMPLOYEE';

UPDATE employees e
SET role = 'LEADER',
    subarea_id = (SELECT s.id FROM subareas s JOIN departments d ON d.id = s.department_id
                  WHERE d.code = 'CENTRAL' AND s.code = 'PT'),
    updated_at = now()
WHERE e.seed_key = 'DIA-CENTRAL-manuel-cruz'
  AND e.department_id = (SELECT id FROM departments WHERE code = 'CENTRAL');

INSERT INTO audit_logs (actor_type, actor_label, action, entity, details)
SELECT 'SYSTEM', 'migración 003', 'LEADERS_ASSIGNED', 'employee',
       '{"central":["Isaías Romero","Javier Ángeles"],"pt":["Manuel Cruz"],"rc":["Gerardo Marroquín","Gerardo González"],"lavadoras":["Jonathan Cruz"]}'::jsonb
WHERE EXISTS (SELECT 1 FROM employees WHERE seed_key IS NOT NULL);
