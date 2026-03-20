-- =============================================================================
-- MIGRACIÓN 002 — Perfiles específicos: clientes, taxistas y vehículos
-- =============================================================================
-- Cada rol tiene datos propios que no comparten con los demás.
-- En lugar de meter todos los campos en 'profiles' (tabla dios), usamos
-- tablas separadas por rol (principio SRP + ISP de SOLID).
--
-- Estructura:
--   clientes_perfil   → datos exclusivos del cliente
--   taxistas_perfil   → datos exclusivos del taxista
--   vehiculos         → vehículo con su licencia municipal asociada
--   taxista_vehiculo  → relación muchos a muchos entre taxistas y vehículos
--
-- Contexto del negocio (importante para entender el modelo):
--   - La licencia municipal va asociada al vehículo, no al conductor.
--   - Un vehículo puede ser conducido por varios taxistas (propietario + asalariados).
--   - Un taxista puede estar autorizado a conducir varios vehículos.
--   - Cuando un taxista acepta un trayecto, asigna el vehículo que usará,
--     y puede cambiarlo hasta que el servicio comience.
--
-- Depende de: migración 001 (tabla profiles, función actualizar_updated_at)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLA: clientes_perfil
-- Información adicional del cliente que no es común a todos los usuarios.
-- -----------------------------------------------------------------------------
CREATE TABLE clientes_perfil (
  -- Relación 1:1 con profiles. Si se borra el perfil base, se borra este también.
  profile_id          UUID          PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- Dirección habitual de recogida del cliente (su casa, trabajo, etc.).
  -- Facilita la reserva rápida sin tener que introducir el origen cada vez.
  direccion_habitual  TEXT,

  -- Notas internas del operador sobre este cliente (incidencias, preferencias...).
  -- No es visible para el propio cliente; solo accesible para admins.
  notas_internas      TEXT,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_clientes_perfil_updated_at
  BEFORE UPDATE ON clientes_perfil
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: taxistas_perfil
-- Datos profesionales del taxista como conductor.
-- La licencia ya NO está aquí porque va ligada al vehículo, no al conductor.
-- Un conductor asalariado opera bajo la licencia del vehículo que conduce.
-- -----------------------------------------------------------------------------
CREATE TABLE taxistas_perfil (
  profile_id            UUID          PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- Indica si este taxista es propietario/titular de al menos un vehículo.
  -- Los titulares pueden gestionar qué conductores tienen acceso a su vehículo.
  -- Los no titulares son conductores asalariados o colaboradores.
  es_titular            BOOLEAN       NOT NULL DEFAULT FALSE,

  -- ID de la cuenta conectada en Stripe Connect.
  -- Se asigna cuando el taxista completa el onboarding de Stripe (verificación
  -- bancaria). Hasta entonces es NULL y no puede recibir pagos.
  stripe_account_id     TEXT          UNIQUE,

  -- Indica si el taxista está disponible para recibir nuevos trayectos.
  -- El admin puede cambiar este valor independientemente del campo 'activo'
  -- de profiles, que representa una suspensión más grave (bloqueo total).
  disponible            BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Valoración media calculada a partir de las reseñas de clientes.
  -- Rango: 0.0 a 5.0. Se recalcula cada vez que se registra una nueva reseña.
  valoracion_media      NUMERIC(3,2)  NOT NULL DEFAULT 0.0
    CONSTRAINT chk_valoracion CHECK (valoracion_media >= 0.0 AND valoracion_media <= 5.0),

  -- Número total de servicios completados. Útil para mostrar experiencia
  -- en la app cliente y para calcular estadísticas del panel admin.
  servicios_completados INTEGER       NOT NULL DEFAULT 0,

  notas_internas        TEXT,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_taxistas_perfil_updated_at
  BEFORE UPDATE ON taxistas_perfil
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: vehiculos
-- Representa un vehículo de taxi con su licencia municipal asociada.
--
-- La licencia va aquí (no en taxistas_perfil) porque en el sector del taxi
-- la licencia ampara al vehículo, no al conductor. Un titular puede tener
-- varios conductores asalariados que operan bajo la misma licencia.
-- -----------------------------------------------------------------------------
CREATE TABLE vehiculos (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Taxista propietario/titular del vehículo y de su licencia.
  -- Es quien da de alta el vehículo en la plataforma.
  propietario_id      UUID        NOT NULL REFERENCES taxistas_perfil(profile_id),

  marca               TEXT        NOT NULL,   -- Ej: Toyota, Mercedes, Seat
  modelo              TEXT        NOT NULL,   -- Ej: Prius, Vito, León
  matricula           TEXT        NOT NULL UNIQUE,
  color               TEXT        NOT NULL,

  -- Número de plazas de pasajeros, sin contar al conductor.
  -- Relevante para trayectos de grupo o familias numerosas.
  plazas              SMALLINT    NOT NULL DEFAULT 4
    CONSTRAINT chk_plazas CHECK (plazas > 0 AND plazas <= 8),

  -- Número de licencia municipal de taxi asociado a este vehículo.
  -- Es único: no puede haber dos vehículos con la misma licencia.
  numero_licencia     TEXT        NOT NULL UNIQUE,

  -- Municipio donde está dada de alta la licencia (Jerez, Cádiz, Sanlúcar...).
  -- Determina en qué zona puede operar legalmente este vehículo.
  municipio_licencia  TEXT        NOT NULL,

  -- Indica si el vehículo está operativo en la flota.
  -- FALSE significa que está retirado, en reparación o dado de baja.
  -- No indica si está siendo usado en este momento (eso lo gestiona el trayecto).
  activo              BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_vehiculos_updated_at
  BEFORE UPDATE ON vehiculos
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: taxista_vehiculo
-- Tabla intermedia de la relación muchos a muchos entre taxistas y vehículos.
--
-- Casos reales que cubre este modelo:
--   - Un titular con dos conductores asalariados que comparten su taxi.
--   - Un conductor que trabaja en el taxi de un compañero además del suyo.
--   - El titular siempre aparece aquí también (con es_propietario = TRUE).
--
-- Cuando un taxista entre en la app para ponerse disponible, verá únicamente
-- los vehículos donde tiene una fila activa en esta tabla.
-- -----------------------------------------------------------------------------
CREATE TABLE taxista_vehiculo (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  taxista_id    UUID        NOT NULL REFERENCES taxistas_perfil(profile_id) ON DELETE CASCADE,
  vehiculo_id   UUID        NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,

  -- Indica si este taxista es el propietario/titular de este vehículo.
  -- Solo puede haber un propietario por vehículo (ver índice único parcial abajo).
  es_propietario BOOLEAN    NOT NULL DEFAULT FALSE,

  -- Indica si este taxista tiene autorización activa para usar este vehículo.
  -- El titular puede revocar el acceso a un conductor sin eliminar el historial.
  autorizado    BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Fecha desde la que el taxista está autorizado a usar este vehículo.
  -- Útil para auditorías y para saber cuándo se incorporó un conductor.
  autorizado_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un taxista no puede tener dos filas para el mismo vehículo
  CONSTRAINT uq_taxista_vehiculo UNIQUE (taxista_id, vehiculo_id)
);

CREATE TRIGGER trg_taxista_vehiculo_updated_at
  BEFORE UPDATE ON taxista_vehiculo
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índice parcial único: garantiza que cada vehículo tenga solo un propietario.
CREATE UNIQUE INDEX idx_un_propietario_por_vehiculo
  ON taxista_vehiculo (vehiculo_id)
  WHERE es_propietario = TRUE;

-- =============================================================================
-- SEGURIDAD: Row Level Security
-- =============================================================================

-- --- clientes_perfil ---
ALTER TABLE clientes_perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_su_perfil" ON clientes_perfil
  FOR ALL
  USING     (auth.uid() = profile_id)
  WITH CHECK(auth.uid() = profile_id);

CREATE POLICY "admin_lee_clientes" ON clientes_perfil
  FOR SELECT
  USING (obtener_rol_actual() = 'admin');


-- --- taxistas_perfil ---
ALTER TABLE taxistas_perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY "taxista_su_perfil" ON taxistas_perfil
  FOR ALL
  USING     (auth.uid() = profile_id)
  WITH CHECK(auth.uid() = profile_id);

CREATE POLICY "admin_gestiona_taxistas" ON taxistas_perfil
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- vehiculos ---
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;

-- El propietario puede gestionar su vehículo
CREATE POLICY "propietario_su_vehiculo" ON vehiculos
  FOR ALL
  USING     (auth.uid() = propietario_id)
  WITH CHECK(auth.uid() = propietario_id);

-- Los taxistas autorizados pueden leer los vehículos que pueden conducir
CREATE POLICY "taxista_lee_vehiculos_autorizados" ON vehiculos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM taxista_vehiculo tv
      WHERE tv.vehiculo_id = id
        AND tv.taxista_id  = auth.uid()
        AND tv.autorizado  = TRUE
    )
  );

CREATE POLICY "admin_lee_vehiculos" ON vehiculos
  FOR SELECT
  USING (obtener_rol_actual() = 'admin');

-- --- taxista_vehiculo ---
ALTER TABLE taxista_vehiculo ENABLE ROW LEVEL SECURITY;

-- El propietario del vehículo gestiona quién está autorizado a conducirlo
CREATE POLICY "propietario_gestiona_autorizaciones" ON taxista_vehiculo
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vehiculos v
      WHERE v.id            = vehiculo_id
        AND v.propietario_id = auth.uid()
    )
  );

-- Cada taxista puede ver las autorizaciones que le afectan a él
CREATE POLICY "taxista_sus_autorizaciones" ON taxista_vehiculo
  FOR SELECT
  USING (taxista_id = auth.uid());

CREATE POLICY "admin_gestiona_autorizaciones" ON taxista_vehiculo
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
