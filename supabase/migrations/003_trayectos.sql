-- =============================================================================
-- MIGRACIÓN 003 — Trayectos concertados
-- =============================================================================
-- El trayecto concertado es el SERVICIO ESTRELLA del MVP.
-- El cliente reserva con días de antelación, se le asigna un taxista titular
-- y uno de reserva. El titular confirma 1 hora antes o el sistema pasa
-- automáticamente al taxista de reserva.
--
-- Flujo de estados de un trayecto:
--
--   pendiente → asignado → confirmado → en_curso → completado
--                                    ↘
--                              cancelado (en cualquier punto antes de en_curso)
--
-- Decisiones de diseño:
--   - Los importes (precio, comisión, pago al taxista) se guardan en el trayecto
--     además de en pagos, porque las tarifas pueden cambiar en el futuro y
--     los registros históricos deben reflejar lo que se cobró en su momento.
--   - El vehículo es asignable y modificable hasta que el trayecto pase a en_curso.
--   - Las coordenadas usan el tipo GEOMETRY de PostGIS para permitir consultas
--     geográficas en el futuro (distancia, taxistas cercanos, etc.).
--
-- Depende de: migraciones 001 y 002
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TIPO: estado_trayecto
-- Enum que representa el ciclo de vida de un trayecto.
-- Usar ENUM evita que pueda insertarse un estado inválido o mal escrito.
-- -----------------------------------------------------------------------------
CREATE TYPE estado_trayecto AS ENUM (
  'pendiente',    -- Reserva creada, sin taxista asignado aún
  'asignado',     -- Taxista titular (y de reserva) asignados, pendiente de confirmar
  'confirmado',   -- El taxista titular ha confirmado que realizará el servicio
  'en_curso',     -- El taxista ha iniciado el trayecto (recogió al cliente)
  'completado',   -- El servicio ha finalizado correctamente
  'cancelado'     -- Cancelado por el cliente, el taxista o el sistema
);


-- -----------------------------------------------------------------------------
-- TABLA: trayectos
-- Núcleo del sistema. Cada fila representa un servicio de transporte reservado.
-- -----------------------------------------------------------------------------
CREATE TABLE trayectos (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cliente que realiza la reserva
  cliente_id            UUID            NOT NULL REFERENCES clientes_perfil(profile_id),

  -- Taxista principal asignado al trayecto. Puede ser NULL hasta que el sistema
  -- encuentre un taxista disponible y lo asigne.
  taxista_titular_id    UUID            REFERENCES taxistas_perfil(profile_id),

  -- Taxista de reserva: entra en juego si el titular no confirma 1 hora antes.
  -- También puede ser NULL si aún no se ha asignado reserva.
  taxista_reserva_id    UUID            REFERENCES taxistas_perfil(profile_id),

  -- Vehículo que se usará para este trayecto.
  -- Lo asigna el taxista al aceptar el servicio. Puede cambiarse hasta que
  -- el trayecto pase a estado 'en_curso'.
  vehiculo_id           UUID            REFERENCES vehiculos(id),

  -- Estado actual del trayecto (ver tipo estado_trayecto arriba)
  estado                estado_trayecto NOT NULL DEFAULT 'pendiente',

  -- -------------------------------------------------------------------------
  -- Origen y destino: guardamos tanto el texto (dirección legible) como las
  -- coordenadas geográficas. El texto se muestra al usuario; las coordenadas
  -- se usan para el mapa y para calcular distancias.
  -- GEOMETRY(POINT, 4326): punto geográfico en el sistema WGS84 (el estándar
  -- de GPS y Google Maps). El orden es (longitud, latitud).
  -- -------------------------------------------------------------------------
  origen_texto          TEXT            NOT NULL,
  origen_coords         GEOMETRY(POINT, 4326),

  destino_texto         TEXT            NOT NULL,
  destino_coords        GEOMETRY(POINT, 4326),

  -- Fecha y hora en que el taxista debe recoger al cliente
  fecha_hora_recogida   TIMESTAMPTZ     NOT NULL,

  -- Duración estimada del trayecto en minutos (calculada al crear la reserva)
  duracion_estimada_min INTEGER
    CONSTRAINT chk_duracion CHECK (duracion_estimada_min > 0),

  -- -------------------------------------------------------------------------
  -- Importes económicos
  -- Se guardan los tres valores aunque uno sea derivable de los otros,
  -- porque las tarifas y comisiones pueden cambiar y los registros históricos
  -- deben reflejar exactamente lo que se cobró en el momento del servicio.
  -- -------------------------------------------------------------------------

  -- Lo que paga el cliente. Precio cerrado, sin sorpresas.
  precio_cliente        NUMERIC(8,2)    NOT NULL
    CONSTRAINT chk_precio CHECK (precio_cliente > 0),

  -- Porcentaje o importe fijo que se queda la plataforma ConCompas
  comision_plataforma   NUMERIC(8,2)    NOT NULL DEFAULT 0.00,

  -- Lo que recibe el taxista: precio_cliente - comision_plataforma
  importe_taxista       NUMERIC(8,2)    NOT NULL,

  -- -------------------------------------------------------------------------
  -- Referencias a Stripe
  -- Se rellenan cuando se procesa el pago (migración 005 — pagos)
  -- -------------------------------------------------------------------------

  -- ID del PaymentIntent de Stripe: se crea cuando el cliente confirma la reserva
  -- y garantiza que el dinero queda retenido hasta que el servicio se complete.
  stripe_payment_intent_id  TEXT        UNIQUE,

  -- Notas del cliente para el taxista (vuelo de llegada, equipaje especial, etc.)
  notas_cliente         TEXT,

  -- Motivo de cancelación, si aplica. Útil para estadísticas y disputas.
  motivo_cancelacion    TEXT,

  -- Fecha y hora real en que finalizó el trayecto (puede diferir de la estimada)
  finalizado_at         TIMESTAMPTZ,

  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_trayectos_updated_at
  BEFORE UPDATE ON trayectos
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índice para consultas frecuentes: buscar trayectos de un cliente o taxista
CREATE INDEX idx_trayectos_cliente   ON trayectos (cliente_id);
CREATE INDEX idx_trayectos_titular   ON trayectos (taxista_titular_id);
CREATE INDEX idx_trayectos_reserva   ON trayectos (taxista_reserva_id);
CREATE INDEX idx_trayectos_estado    ON trayectos (estado);
CREATE INDEX idx_trayectos_fecha     ON trayectos (fecha_hora_recogida);


-- =============================================================================
-- SEGURIDAD: Row Level Security
-- =============================================================================
ALTER TABLE trayectos ENABLE ROW LEVEL SECURITY;

-- El cliente puede ver sus propios trayectos
CREATE POLICY "cliente_sus_trayectos" ON trayectos
  FOR SELECT
  USING (auth.uid() = cliente_id);

-- El taxista titular puede ver los trayectos que tiene asignados
CREATE POLICY "taxista_titular_sus_trayectos" ON trayectos
  FOR SELECT
  USING (auth.uid() = taxista_titular_id);

-- El taxista de reserva también puede ver los trayectos donde está asignado
CREATE POLICY "taxista_reserva_sus_trayectos" ON trayectos
  FOR SELECT
  USING (auth.uid() = taxista_reserva_id);

-- El cliente puede crear trayectos (INSERT)
CREATE POLICY "cliente_crea_trayecto" ON trayectos
  FOR INSERT
  WITH CHECK (auth.uid() = cliente_id);

-- El cliente puede cancelar su trayecto (UPDATE solo del campo estado/motivo)
-- La lógica de qué campos puede modificar y en qué estados se controla en el backend
CREATE POLICY "cliente_actualiza_trayecto" ON trayectos
  FOR UPDATE
  USING (auth.uid() = cliente_id);

-- El taxista titular puede actualizar el trayecto que tiene asignado:
-- cambiar el estado (confirmado, en_curso, completado) y cambiar el vehículo
-- asignado (solo mientras el trayecto no esté en_curso o completado).
-- El taxista de reserva solo puede actualizar el estado si entra en juego.
-- El control fino de qué campos puede modificar cada rol y en qué estados
-- se gestiona en la lógica del backend, no aquí en RLS.
CREATE POLICY "taxista_actualiza_trayecto" ON trayectos
  FOR UPDATE
  USING (
    auth.uid() = taxista_titular_id
    OR auth.uid() = taxista_reserva_id
  );

-- Los admins tienen acceso total
CREATE POLICY "admin_gestiona_trayectos" ON trayectos
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
