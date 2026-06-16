-- =============================================================================
-- MIGRACIÓN 007 — Eliminar estado 'confirmado' del ENUM estado_trayecto
-- =============================================================================
-- Decisión de negocio: el estado 'confirmado' no aporta valor real al cliente.
-- La tranquilidad del cliente viene del sistema de penalizaciones, no de un estado
-- intermedio. El flujo queda: pendiente → asignado → en_curso → completado | cancelado.
--
-- PostgreSQL no permite eliminar valores de un ENUM con ALTER TYPE ... DROP VALUE.
-- La solución estándar es:
--   1. Crear un nuevo ENUM sin el valor a eliminar
--   2. Migrar la columna al nuevo tipo
--   3. Eliminar el tipo antiguo
--   4. Renombrar el nuevo tipo al nombre original
--
-- IMPORTANTE: Esta migración asume que no hay filas con estado = 'confirmado'
-- en la tabla trayectos. Si las hubiera, el USING del paso 2 lanzaría un error
-- porque 'confirmado' no existe en el nuevo tipo. En desarrollo esto es seguro.
-- =============================================================================


-- Paso 1: Nuevo ENUM sin 'confirmado'
CREATE TYPE estado_trayecto_v2 AS ENUM (
  'pendiente',
  'asignado',
  'en_curso',
  'completado',
  'cancelado'
);


-- Paso 2: Quitar los DEFAULT de las dos tablas que usan el ENUM.
-- PostgreSQL no puede castear automáticamente el DEFAULT al nuevo tipo.
ALTER TABLE trayectos    ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE reservas_tour ALTER COLUMN estado DROP DEFAULT;


-- Paso 3: Migrar las dos columnas al nuevo tipo.
-- El USING convierte el valor actual (text) al nuevo enum.
ALTER TABLE trayectos
  ALTER COLUMN estado TYPE estado_trayecto_v2
  USING estado::text::estado_trayecto_v2;

ALTER TABLE reservas_tour
  ALTER COLUMN estado TYPE estado_trayecto_v2
  USING estado::text::estado_trayecto_v2;


-- Paso 4: Restaurar los DEFAULT en ambas tablas con el nuevo tipo
ALTER TABLE trayectos     ALTER COLUMN estado SET DEFAULT 'pendiente'::estado_trayecto_v2;
ALTER TABLE reservas_tour ALTER COLUMN estado SET DEFAULT 'pendiente'::estado_trayecto_v2;


-- Paso 5: Eliminar el tipo antiguo
DROP TYPE estado_trayecto;


-- Paso 6: Renombrar el nuevo tipo al nombre original para no romper referencias futuras
ALTER TYPE estado_trayecto_v2 RENAME TO estado_trayecto;
