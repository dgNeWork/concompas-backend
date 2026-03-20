-- =============================================================================
-- MIGRACIÓN 004 — Tours turísticos y paradas
-- =============================================================================
-- Un tour es un recorrido turístico predefinido por zonas de una ciudad.
-- Tiene un precio fijo, una duración estimada y una serie de paradas ordenadas,
-- cada una con su descripción y coordenadas para mostrar en el mapa.
--
-- A diferencia de un trayecto concertado (origen/destino libre), un tour
-- sigue siempre el mismo recorrido. El cliente elige el tour, la fecha y
-- el número de pasajeros; el sistema asigna un taxista disponible.
--
-- Estructura:
--   tours         → definición del tour (nombre, ciudad, precio, duración)
--   paradas_tour  → paradas ordenadas dentro de cada tour
--   reservas_tour → cuando un cliente reserva un tour concreto en una fecha
--
-- Depende de: migraciones 001, 002 y 003
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLA: tours
-- Define un tour turístico disponible en la plataforma.
-- Los tours los crea y gestiona el admin desde el panel de administración.
-- -----------------------------------------------------------------------------
CREATE TABLE tours (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nombre del tour que verá el cliente en la app
  nombre                TEXT          NOT NULL,

  -- Ciudad o zona donde se realiza el tour (Jerez, Cádiz, Sanlúcar...)
  ciudad                TEXT          NOT NULL,

  -- Descripción larga para mostrar en la ficha del tour en la app cliente
  descripcion           TEXT,

  -- Duración estimada del tour completo en minutos
  duracion_estimada_min INTEGER       NOT NULL
    CONSTRAINT chk_duracion_tour CHECK (duracion_estimada_min > 0),

  -- Precio fijo por vehículo (no por pasajero).
  -- El cliente paga este importe independientemente del número de personas,
  -- siempre que quepan en el taxi.
  precio                NUMERIC(8,2)  NOT NULL
    CONSTRAINT chk_precio_tour CHECK (precio > 0),

  -- Indica si el tour está visible y reservable en la app.
  -- Permite desactivar un tour temporalmente sin eliminarlo.
  activo                BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Imagen de portada del tour (URL almacenada en Supabase Storage)
  imagen_url            TEXT,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tours_updated_at
  BEFORE UPDATE ON tours
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: paradas_tour
-- Cada fila es una parada dentro de un tour, con su orden, descripción
-- y coordenadas para pintarla en el mapa de la app.
-- -----------------------------------------------------------------------------
CREATE TABLE paradas_tour (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tour al que pertenece esta parada
  tour_id       UUID        NOT NULL REFERENCES tours(id) ON DELETE CASCADE,

  -- Orden de visita dentro del tour (1 = primera parada, 2 = segunda, etc.)
  orden         SMALLINT    NOT NULL
    CONSTRAINT chk_orden CHECK (orden > 0),

  -- Nombre del lugar (Catedral de Jerez, Bodegas González Byass, etc.)
  nombre        TEXT        NOT NULL,

  -- Texto explicativo que el taxista o la app leerá/mostrará en esa parada
  descripcion   TEXT,

  -- Coordenadas geográficas de la parada para mostrar en el mapa
  coords        GEOMETRY(POINT, 4326),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No puede haber dos paradas con el mismo orden dentro del mismo tour
  CONSTRAINT uq_orden_en_tour UNIQUE (tour_id, orden)
);

CREATE TRIGGER trg_paradas_tour_updated_at
  BEFORE UPDATE ON paradas_tour
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: reservas_tour
-- Cuando un cliente reserva un tour en una fecha concreta, se crea una fila
-- aquí. Es el equivalente a 'trayectos' pero para tours.
--
-- Reutilizamos el mismo tipo estado_trayecto definido en la migración 003,
-- ya que el ciclo de vida es el mismo (pendiente → asignado → ... → completado).
-- -----------------------------------------------------------------------------
CREATE TABLE reservas_tour (
  id                        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tour que se va a realizar
  tour_id                   UUID            NOT NULL REFERENCES tours(id),

  -- Cliente que realiza la reserva
  cliente_id                UUID            NOT NULL REFERENCES clientes_perfil(profile_id),

  -- Taxista principal asignado para realizar el tour
  taxista_id                UUID            REFERENCES taxistas_perfil(profile_id),

  -- Taxista de reserva, actua si el principal se desasigna o no puede
  taxista_reserva_id        UUID            REFERENCES taxistas_perfil(profile_id),

  -- Vehículo que se usará. Asignable y modificable hasta que empiece el tour.
  vehiculo_id               UUID            REFERENCES vehiculos(id),

  -- Estado del ciclo de vida (mismo enum que los trayectos concertados)
  estado                    estado_trayecto NOT NULL DEFAULT 'pendiente',

  -- Fecha y hora de inicio del tour
  fecha_hora_inicio         TIMESTAMPTZ     NOT NULL,

  -- Número de pasajeros para comprobar que caben en el vehículo asignado
  num_pasajeros             SMALLINT        NOT NULL DEFAULT 1
    CONSTRAINT chk_pasajeros CHECK (num_pasajeros > 0 AND num_pasajeros <= 8),

  -- Precio aplicado en el momento de la reserva. Se guarda aquí para que
  -- cambios futuros en tours.precio no afecten a reservas ya confirmadas.
  precio_cobrado            NUMERIC(8,2)    NOT NULL,
  comision_plataforma       NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
  importe_taxista           NUMERIC(8,2)    NOT NULL,

  -- Referencia al PaymentIntent de Stripe (ver migración 005)
  stripe_payment_intent_id  TEXT            UNIQUE,

  notas_cliente             TEXT,
  motivo_cancelacion        TEXT,
  finalizado_at             TIMESTAMPTZ,

  created_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_reservas_tour_updated_at
  BEFORE UPDATE ON reservas_tour
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE INDEX idx_reservas_tour_cliente  ON reservas_tour (cliente_id);
CREATE INDEX idx_reservas_tour_taxista  ON reservas_tour (taxista_id);
CREATE INDEX idx_reservas_tour_estado   ON reservas_tour (estado);
CREATE INDEX idx_reservas_tour_fecha    ON reservas_tour (fecha_hora_inicio);


-- =============================================================================
-- SEGURIDAD: Row Level Security
-- =============================================================================

-- --- tours ---
ALTER TABLE tours ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede ver los tours activos
CREATE POLICY "usuarios_ven_tours_activos" ON tours
  FOR SELECT
  USING (activo = TRUE);

-- Solo los admins pueden crear, editar y desactivar tours
CREATE POLICY "admin_gestiona_tours" ON tours
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- paradas_tour ---
ALTER TABLE paradas_tour ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede ver las paradas de los tours activos
CREATE POLICY "usuarios_ven_paradas" ON paradas_tour
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      WHERE t.id = tour_id AND t.activo = TRUE
    )
  );

CREATE POLICY "admin_gestiona_paradas" ON paradas_tour
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- reservas_tour ---
ALTER TABLE reservas_tour ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_sus_reservas_tour" ON reservas_tour
  FOR SELECT
  USING (auth.uid() = cliente_id);

CREATE POLICY "cliente_crea_reserva_tour" ON reservas_tour
  FOR INSERT
  WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY "cliente_cancela_reserva_tour" ON reservas_tour
  FOR UPDATE
  USING (auth.uid() = cliente_id);

CREATE POLICY "taxista_sus_tours_asignados" ON reservas_tour
  FOR SELECT
  USING (auth.uid() = taxista_id OR auth.uid() = taxista_reserva_id);

CREATE POLICY "taxista_actualiza_reserva_tour" ON reservas_tour
  FOR UPDATE
  USING (auth.uid() = taxista_id OR auth.uid() = taxista_reserva_id);

CREATE POLICY "admin_gestiona_reservas_tour" ON reservas_tour
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
