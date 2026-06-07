-- =============================================================================
-- MIGRACIÓN 006 — Reglas de negocio: matching, recargos, cancelaciones e incentivos
-- =============================================================================
-- Esta migración materializa las reglas de negocio acordadas con los taxistas.
-- Extiende las tablas existentes y crea las tablas de configuración y control
-- necesarias para el sistema de reservas completo.
--
-- Cambios sobre tablas existentes:
--   taxistas_perfil → municipio donde opera el taxista (para el matching de trayectos)
--                   → saldo de incentivos y penalizaciones pendientes
--   trayectos       → tipo de reserva, tipo de punto (aeropuerto, muelle...) y recargo
--
-- Nuevas tablas:
--   configuracion_recargos        → tabla de recargos por antelación (editable desde admin)
--   eventos_especiales_provincia  → eventos donde cualquier taxi de la provincia puede operar
--   penalizaciones_taxista        → registro de penalizaciones por cancelación
--   retiros_incentivo             → solicitudes de retiro del wallet de incentivos
--
-- Depende de: migraciones 001, 002, 003
-- =============================================================================


-- =============================================================================
-- SECCIÓN 1 — Nuevos tipos ENUM
-- =============================================================================

-- Tipo de reserva: solo ida o ida y vuelta en el MVP.
-- El tiempo de espera en ida y vuelta se paga directamente al taxista,
-- no pasa por la plataforma.
CREATE TYPE tipo_reserva AS ENUM (
  'ida',        -- Punto A → Punto B, hora fija
  'ida_vuelta'  -- Punto A → Punto B, con vuelta. Espera pagada al taxista en mano
);


-- Tipo de punto (aplicable a origen y destino).
-- Determina qué regla de licencia municipal se aplica:
--   - aeropuerto / muelle: prevalece el municipio de DESTINO para asignar el taxi
--   - normal: prevalece el municipio de ORIGEN (regla general)
CREATE TYPE tipo_punto AS ENUM (
  'normal',      -- Dirección convencional (calle, plaza, domicilio...)
  'aeropuerto',  -- Terminal aérea (ej: Aeropuerto de Sevilla, Aeropuerto de Jerez)
  'muelle'       -- Puerto marítimo (ej: Muelle de Cádiz)
);


-- Estado del ciclo de vida de una penalización al taxista.
CREATE TYPE estado_penalizacion AS ENUM (
  'pendiente',                    -- Generada, aún no descontada del pago
  'descontada',                   -- Ya descontada de un pago o de los incentivos
  'cancelada_con_justificacion'   -- El admin la anuló tras revisar la justificación del taxista
);


-- Estado del ciclo de vida de una solicitud de retiro de incentivos.
CREATE TYPE estado_retiro AS ENUM (
  'pendiente',   -- Solicitud recibida, el sistema aún no ha procesado el Transfer en Stripe
  'procesado',   -- Transfer de Stripe completado; el dinero está en camino al banco del taxista
  'rechazado'    -- No se pudo procesar (saldo insuficiente, cuenta Stripe inactiva, etc.)
);


-- =============================================================================
-- SECCIÓN 2 — Extensión de taxistas_perfil
-- =============================================================================

-- Municipio donde opera este taxista. Determina qué trayectos puede ver y aceptar.
-- Regla general: el taxista solo ve trayectos cuyo origen está en su municipio.
-- Excepciones (aeropuertos, muelles, eventos): ver tabla trayectos y eventos_especiales_provincia.
--
-- Nota: la licencia formal está ligada al vehículo (tabla vehiculos.municipio_licencia).
-- Este campo representa el municipio operativo del conductor, que puede conducir vehículos
-- de otros propietarios. Para asalariados que usan el taxi de otro, este valor permite
-- filtrar el matching sin tener que recorrer toda la tabla taxista_vehiculo.
ALTER TABLE taxistas_perfil
  ADD COLUMN municipio_licencia TEXT;

-- Saldo acumulado de incentivos del taxista. Se incrementa con cada servicio completado
-- según el porcentaje de incentivo pactado. El taxista elige cuándo retirar este saldo
-- mediante una solicitud de retiro (tabla retiros_incentivo).
ALTER TABLE taxistas_perfil
  ADD COLUMN incentivo_acumulado NUMERIC(8,2) NOT NULL DEFAULT 0.00
    CONSTRAINT chk_incentivo_no_negativo CHECK (incentivo_acumulado >= 0);

-- Importe total de penalizaciones pendientes de descontar.
-- Se incrementa cuando se genera una penalización y se decrementa cuando se descuenta
-- del siguiente pago o de los incentivos acumulados.
ALTER TABLE taxistas_perfil
  ADD COLUMN penalizacion_pendiente NUMERIC(8,2) NOT NULL DEFAULT 0.00
    CONSTRAINT chk_penalizacion_no_negativa CHECK (penalizacion_pendiente >= 0);

-- Número mínimo de servicios mensuales que el taxista se compromete a realizar.
-- Campo opcional; se define en el acuerdo de adhesión a la plataforma.
-- La norma mínima y las consecuencias de no cumplirla se gestionan desde el panel admin.
ALTER TABLE taxistas_perfil
  ADD COLUMN min_servicios_mensuales INTEGER
    CONSTRAINT chk_min_servicios CHECK (min_servicios_mensuales > 0);


-- =============================================================================
-- SECCIÓN 3 — Extensión de trayectos
-- =============================================================================

-- Tipo de reserva: ida simple o ida y vuelta.
-- Afecta al cálculo del precio y a lo que el sistema gestiona:
-- el tiempo de espera en ida_vuelta no pasa por la plataforma.
ALTER TABLE trayectos
  ADD COLUMN tipo_reserva tipo_reserva NOT NULL DEFAULT 'ida';

-- Tipo del punto de origen.
-- Si es aeropuerto o muelle, la regla de asignación de taxistas cambia:
-- en lugar del municipio de origen, se usa el municipio de destino.
ALTER TABLE trayectos
  ADD COLUMN tipo_punto_origen tipo_punto NOT NULL DEFAULT 'normal';

-- Tipo del punto de destino.
-- Relevante para aplicar la misma lógica de licencia municipal en el destino
-- cuando el origen es aeropuerto o muelle.
ALTER TABLE trayectos
  ADD COLUMN tipo_punto_destino tipo_punto NOT NULL DEFAULT 'normal';

-- Porcentaje de recargo por antelación aplicado a este trayecto.
-- Se calcula en el momento de crear la reserva según la tabla configuracion_recargos
-- y se guarda aquí para que el historial refleje el recargo real cobrado,
-- aunque la tabla de configuración cambie en el futuro.
ALTER TABLE trayectos
  ADD COLUMN recargo_antelacion_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0.00
    CONSTRAINT chk_recargo CHECK (recargo_antelacion_porcentaje >= 0);

-- Hora estimada en que el taxista debe salir desde su municipio para llegar
-- a tiempo al punto de recogida. La calcula el backend con la API de Google Maps
-- en el momento en que el taxista acepta la reserva.
-- Es clave para el sistema de cancelaciones: si el usuario cancela después de
-- que el taxista ya ha salido, el cobro es el servicio completo.
ALTER TABLE trayectos
  ADD COLUMN hora_salida_estimada_taxista TIMESTAMPTZ;


-- =============================================================================
-- SECCIÓN 4 — TABLA: configuracion_recargos
-- =============================================================================
-- Almacena los tramos de antelación con su recargo correspondiente.
-- Editable desde el panel de administración sin tocar código.
--
-- Cada fila define un tramo: "si la reserva se hace entre horas_desde y horas_hasta
-- antes de la recogida, se aplica este porcentaje de recargo".
--
-- Ejemplos de filas que el admin configuraría:
--   horas_desde=0,  horas_hasta=1,  porcentaje=40.00, descripcion='Para Ya!'
--   horas_desde=1,  horas_hasta=12, porcentaje=25.00, descripcion='Menos de 12 horas'
--   horas_desde=12, horas_hasta=24, porcentaje=15.00, descripcion='Entre 12 y 24 horas'
--   horas_desde=24, horas_hasta=48, porcentaje=5.00,  descripcion='Entre 24 y 48 horas'
--   horas_desde=48, horas_hasta=NULL, porcentaje=0.00, descripcion='Con más de 48 horas'
-- =============================================================================
CREATE TABLE configuracion_recargos (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Límite inferior del tramo en horas (0 = reserva inmediata "Para Ya!")
  horas_desde  NUMERIC(5,1) NOT NULL
    CONSTRAINT chk_horas_desde CHECK (horas_desde >= 0),

  -- Límite superior del tramo en horas. NULL significa sin límite superior (ej: 48h o más).
  horas_hasta  NUMERIC(5,1)
    CONSTRAINT chk_horas_hasta CHECK (horas_hasta > horas_desde),

  -- Porcentaje de recargo que se suma al precio base del trayecto.
  porcentaje   NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_porcentaje CHECK (porcentaje >= 0 AND porcentaje <= 100),

  -- Descripción legible para el panel de administración (ej: "Reserva con menos de 12 horas")
  descripcion  TEXT         NOT NULL,

  -- Permite desactivar un tramo sin borrarlo (para conservar el historial de cambios)
  activo       BOOLEAN      NOT NULL DEFAULT TRUE,

  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_configuracion_recargos_updated_at
  BEFORE UPDATE ON configuracion_recargos
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- =============================================================================
-- SECCIÓN 5 — TABLA: eventos_especiales_provincia
-- =============================================================================
-- Registro de eventos en la provincia de Cádiz durante los cuales cualquier taxista
-- de la provincia puede aceptar reservas, independientemente de su municipio de licencia.
--
-- Casos de uso: Feria de Jerez, Carnavales de Cádiz, Semana Santa, festivales...
-- El admin los crea y gestiona. Los porcentajes y condiciones se pactan con los taxistas
-- y asociaciones del sector antes de cada evento.
--
-- Cuando el backend busca taxistas para una reserva, comprueba si la fecha de recogida
-- cae dentro de un evento activo. Si es así, la restricción de municipio se levanta.
-- =============================================================================
CREATE TABLE eventos_especiales_provincia (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nombre del evento (ej: "Feria del Caballo de Jerez 2026")
  nombre       TEXT    NOT NULL,

  -- Rango de fechas en que aplica la excepción de licencia provincial
  fecha_inicio DATE    NOT NULL,
  fecha_fin    DATE    NOT NULL
    CONSTRAINT chk_fechas_evento CHECK (fecha_fin >= fecha_inicio),

  -- Permite desactivar el evento sin borrarlo (útil si se cancela el evento)
  activo       BOOLEAN NOT NULL DEFAULT TRUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_eventos_especiales_updated_at
  BEFORE UPDATE ON eventos_especiales_provincia
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índice para la consulta más frecuente: buscar eventos activos en un rango de fechas
CREATE INDEX idx_eventos_fechas ON eventos_especiales_provincia (fecha_inicio, fecha_fin)
  WHERE activo = TRUE;


-- =============================================================================
-- SECCIÓN 6 — TABLA: penalizaciones_taxista
-- =============================================================================
-- Registra cada penalización generada cuando un taxista cancela un servicio aceptado.
-- El importe depende de cuántas horas antes del servicio se produce la cancelación
-- (ver tabla de penalizaciones en la documentación del negocio).
--
-- Flujo económico de Stripe Connect (no permite cargar directamente a cuentas Connect):
--   1. Se descuenta del incentivo_acumulado del taxista (si hay saldo suficiente)
--   2. Si no hay saldo de incentivo, se descuenta del siguiente pago por un servicio
--   3. Si el saldo negativo persiste más de X días → suspensión de cuenta hasta regularizar
--
-- El taxista puede presentar una justificación (parte médico, etc.) para que el admin
-- la revise y, si procede, la anule (estado → cancelada_con_justificacion).
-- =============================================================================
CREATE TABLE penalizaciones_taxista (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),

  taxista_id            UUID                NOT NULL REFERENCES taxistas_perfil(profile_id),
  trayecto_id           UUID                NOT NULL REFERENCES trayectos(id),

  -- Importe de la penalización en euros
  importe               NUMERIC(8,2)        NOT NULL
    CONSTRAINT chk_importe_penalizacion CHECK (importe > 0),

  -- Cuántas horas antes del servicio se produjo la cancelación.
  -- Determina el tramo de penalización aplicado y queda guardado para auditoría.
  horas_antes_servicio  NUMERIC(5,1)        NOT NULL
    CONSTRAINT chk_horas_antes CHECK (horas_antes_servicio >= 0),

  -- Estado actual de la penalización (ver tipo estado_penalizacion)
  estado                estado_penalizacion NOT NULL DEFAULT 'pendiente',

  -- Texto libre que el taxista introduce para solicitar la anulación de la penalización.
  -- El admin lo revisa en el panel y decide si la cancela.
  justificacion         TEXT,

  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_penalizaciones_updated_at
  BEFORE UPDATE ON penalizaciones_taxista
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índices para las consultas más comunes del panel admin y del propio taxista
CREATE INDEX idx_penalizaciones_taxista ON penalizaciones_taxista (taxista_id);
CREATE INDEX idx_penalizaciones_estado  ON penalizaciones_taxista (estado);


-- =============================================================================
-- SECCIÓN 7 — TABLA: retiros_incentivo
-- =============================================================================
-- Gestiona las solicitudes de retiro del wallet de incentivos del taxista.
-- El taxista elige cuándo retirar su saldo acumulado y con qué modalidad:
--   - estándar:    payout normal de Stripe, sin coste adicional (1-2 días hábiles)
--   - instantaneo: Instant Payout de Stripe, 1% de comisión (mínimo 0.40€), inmediato
--
-- Cuando el backend procesa la solicitud, crea un Transfer en Stripe Connect
-- y guarda el ID aquí para trazabilidad.
-- =============================================================================
CREATE TABLE retiros_incentivo (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  taxista_id          UUID          NOT NULL REFERENCES taxistas_perfil(profile_id),

  -- Importe que el taxista ha solicitado retirar
  importe_solicitado  NUMERIC(8,2)  NOT NULL
    CONSTRAINT chk_importe_retiro CHECK (importe_solicitado > 0),

  -- Importe real recibido en el banco. Puede ser menor que el solicitado si se
  -- aplica la comisión del Instant Payout (1%, mín. 0.40€). NULL hasta que se procese.
  importe_recibido    NUMERIC(8,2),

  -- Modalidad elegida por el taxista: 'estandar' (gratis) o 'instantaneo' (1%)
  tipo_payout         TEXT          NOT NULL DEFAULT 'estandar'
    CONSTRAINT chk_tipo_payout CHECK (tipo_payout IN ('estandar', 'instantaneo')),

  -- Estado del proceso (ver tipo estado_retiro)
  estado              estado_retiro NOT NULL DEFAULT 'pendiente',

  -- ID del Transfer de Stripe. Se rellena cuando el backend procesa el retiro.
  -- Permite consultar el estado del pago directamente en el dashboard de Stripe.
  stripe_transfer_id  TEXT          UNIQUE,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_retiros_incentivo_updated_at
  BEFORE UPDATE ON retiros_incentivo
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índice para listar el historial de retiros de un taxista
CREATE INDEX idx_retiros_taxista ON retiros_incentivo (taxista_id);


-- =============================================================================
-- SECCIÓN 8 — Row Level Security
-- =============================================================================

-- --- configuracion_recargos ---
-- Tabla de solo lectura para usuarios normales; solo el admin puede modificarla.
ALTER TABLE configuracion_recargos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publico_lee_recargos_activos" ON configuracion_recargos
  FOR SELECT
  USING (activo = TRUE);

CREATE POLICY "admin_gestiona_recargos" ON configuracion_recargos
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- eventos_especiales_provincia ---
ALTER TABLE eventos_especiales_provincia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publico_lee_eventos_activos" ON eventos_especiales_provincia
  FOR SELECT
  USING (activo = TRUE);

CREATE POLICY "admin_gestiona_eventos" ON eventos_especiales_provincia
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- penalizaciones_taxista ---
ALTER TABLE penalizaciones_taxista ENABLE ROW LEVEL SECURITY;

-- El taxista puede ver sus propias penalizaciones (para saber su situación económica)
CREATE POLICY "taxista_sus_penalizaciones" ON penalizaciones_taxista
  FOR SELECT
  USING (auth.uid() = taxista_id);

-- El taxista puede añadir una justificación a su penalización (UPDATE limitado al campo)
-- El control fino de qué campos puede modificar el taxista se gestiona en el backend
CREATE POLICY "taxista_justifica_penalizacion" ON penalizaciones_taxista
  FOR UPDATE
  USING (auth.uid() = taxista_id);

CREATE POLICY "admin_gestiona_penalizaciones" ON penalizaciones_taxista
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- retiros_incentivo ---
ALTER TABLE retiros_incentivo ENABLE ROW LEVEL SECURITY;

-- El taxista puede ver su historial de retiros y crear nuevas solicitudes
CREATE POLICY "taxista_sus_retiros" ON retiros_incentivo
  FOR SELECT
  USING (auth.uid() = taxista_id);

CREATE POLICY "taxista_solicita_retiro" ON retiros_incentivo
  FOR INSERT
  WITH CHECK (auth.uid() = taxista_id);

CREATE POLICY "admin_gestiona_retiros" ON retiros_incentivo
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
