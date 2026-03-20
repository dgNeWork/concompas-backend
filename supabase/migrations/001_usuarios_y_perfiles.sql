-- =============================================================================
-- MIGRACIÓN 001 — Usuarios y perfiles base
-- =============================================================================
-- Crea la infraestructura de usuarios del sistema.
--
-- Supabase gestiona la autenticación (email, password, tokens) en el esquema
-- interno 'auth.users'. Nosotros NO tocamos ese esquema: solo lo referenciamos.
-- Toda la información del negocio vive en nuestra tabla 'profiles'.
--
-- Principio SRP (Single Responsibility):
--   - auth.users  → autenticación y credenciales (Supabase)
--   - profiles    → datos del negocio (nosotros)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- EXTENSIÓN: PostGIS
-- Necesaria para almacenar y consultar coordenadas geográficas (origen/destino
-- de trayectos, paradas de tours, etc.).
-- Supabase la incluye preinstalada; esta línea solo la activa si no lo está.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;


-- -----------------------------------------------------------------------------
-- FUNCIÓN: actualizar_updated_at()
-- Función reutilizable que actualiza el campo 'updated_at' automáticamente
-- cada vez que se modifica una fila. Se asociará a cada tabla mediante un
-- trigger, evitando duplicar esta lógica en cada una (principio DRY).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Asignamos la hora actual en UTC con zona horaria al campo updated_at
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- TIPO: rol_usuario
-- Enum que define los roles posibles en el sistema.
-- Usar un tipo ENUM en lugar de un TEXT libre garantiza que nunca pueda
-- insertarse un rol inválido como 'administrador' en lugar de 'admin'.
-- -----------------------------------------------------------------------------
CREATE TYPE rol_usuario AS ENUM (
  'cliente',   -- Usuario final que solicita trayectos o tours
  'taxista',   -- Conductor que presta el servicio
  'admin'      -- Operador interno de la plataforma ConCompas
);


-- -----------------------------------------------------------------------------
-- FUNCIÓN: obtener_rol_actual()
-- Devuelve el rol del usuario autenticado en este momento.
--
-- Se declara con SECURITY DEFINER para que se ejecute con los permisos del
-- propietario de la función (saltándose el RLS de 'profiles'). Esto evita
-- la recursión infinita que ocurriría si una política de RLS de 'profiles'
-- intentara leer 'profiles' para comprobar el rol.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION obtener_rol_actual()
RETURNS rol_usuario
LANGUAGE sql
SECURITY DEFINER  -- Ejecuta con permisos del owner, no del usuario llamante
STABLE            -- No modifica la base de datos y devuelve el mismo resultado
                  -- para el mismo input dentro de una transacción
AS $$
  SELECT rol FROM profiles WHERE id = auth.uid();
$$;


-- -----------------------------------------------------------------------------
-- TABLA: profiles
-- Extensión del sistema de autenticación de Supabase.
-- Cada usuario registrado tiene exactamente una fila aquí.
--
-- La clave primaria es el mismo UUID que genera Supabase en auth.users,
-- lo que permite hacer JOINs sin necesidad de columnas adicionales.
-- ON DELETE CASCADE: si el usuario se elimina de auth.users, su perfil
-- también desaparece. Esto mantiene la integridad referencial.
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
  -- Mismo UUID que auth.users; no generamos uno nuevo para evitar desincronías
  id          UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Rol del usuario en el sistema (ver tipo rol_usuario arriba)
  rol         rol_usuario   NOT NULL,

  -- Nombre de pila del usuario, requerido para identificarlo en la plataforma
  nombre      TEXT          NOT NULL,

  -- Apellidos separados del nombre para permitir ordenación, generación de
  -- documentos formales (facturas, contratos) y validaciones más precisas
  apellidos   TEXT          NOT NULL,

  -- DNI o documento de identidad equivalente (NIE, pasaporte).
  -- Obligatorio para todos los usuarios por trazabilidad legal:
  -- en caso de incidencia o acción legal, la plataforma necesita identificar
  -- inequívocamente a cualquier parte implicada.
  -- NOTA DE SEGURIDAD: este campo contiene PII (Personally Identifiable
  -- Information). En producción se debería cifrar a nivel de aplicación
  -- antes de almacenarlo aquí.
  documento_identidad TEXT   NOT NULL UNIQUE,

  -- Teléfono en el perfil base; los perfiles específicos pueden
  -- añadir más campos de contacto según su rol
  telefono    TEXT          NOT NULL,

  -- Permite desactivar un usuario sin eliminarlo (soft disable).
  -- Útil para suspender cuentas sin perder el historial de trayectos.
  activo      BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Supabase recomienda TIMESTAMPTZ (con zona horaria) para evitar problemas
  -- con zonas horarias distintas entre cliente y servidor
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Trigger que invoca actualizar_updated_at() antes de cada UPDATE en profiles
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- -----------------------------------------------------------------------------
-- SEGURIDAD: Row Level Security (RLS) en profiles
--
-- RLS es el mecanismo de Supabase para que cada usuario solo acceda a los
-- datos que le corresponden. Sin RLS activo, cualquier usuario autenticado
-- podría leer o modificar perfiles ajenos.
--
-- Políticas:
--   1. perfil_propio       → cada usuario lee y edita solo su propio perfil
--   2. admin_lee_perfiles  → los admins pueden leer todos los perfiles
--                            (necesario para el panel de administración)
-- -----------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Política 1: acceso al propio perfil (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "perfil_propio" ON profiles
  FOR ALL
  USING     (auth.uid() = id)
  WITH CHECK(auth.uid() = id);

-- Política 2: los admins pueden leer todos los perfiles
-- Usamos obtener_rol_actual() para evitar recursión (ver función arriba)
CREATE POLICY "admin_lee_perfiles" ON profiles
  FOR SELECT
  USING (obtener_rol_actual() = 'admin');
