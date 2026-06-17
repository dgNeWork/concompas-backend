-- =============================================================================
-- MIGRACIÓN 008 — Sistema de cancelaciones y penalizaciones (Ticket 5.2)
-- =============================================================================
-- NINGÚN porcentaje, ni el umbral de "fuera de ciudad", ni el límite de días de
-- suspensión están negociados con los taxistas todavía. Todos los valores de
-- esta migración son PLACEHOLDERS PROVISIONALES para poder desarrollar y probar
-- el sistema end-to-end. Cuando se negocien los valores reales, la actualización
-- es un UPDATE SQL sobre configuracion_penalizaciones_cancelacion (o un cambio
-- de las variables de entorno SUSPENSION_DIAS_LIMITE / UMBRAL_FUERA_CIUDAD_MINUTOS)
-- — nunca un cambio de código TypeScript ni un ticket nuevo.
--
-- Cambios:
--   taxistas_perfil → penalizacion_pendiente_desde (control de suspensión por impago)
--   pagos           → importe_capturado_real (registro del cobro real en cancelaciones
--                      con captura parcial; importe_total NUNCA se sobreescribe, conserva
--                      siempre el precio original pactado, clave para reclamaciones)
--   Nueva tabla: configuracion_penalizaciones_cancelacion
--
-- Depende de: migración 006 (penalizaciones_taxista, incentivo_acumulado,
-- penalizacion_pendiente), 007 (estado_trayecto sin 'confirmado').
-- =============================================================================


-- =============================================================================
-- SECCIÓN 1 — Extensión de taxistas_perfil
-- =============================================================================

-- Fecha en que penalizacion_pendiente pasó de 0 a un valor positivo. Se limpia a
-- NULL cuando vuelve a 0 (retiro de incentivos, descuento de pago, o el admin
-- anula la penalización). Junto con SUSPENSION_DIAS_LIMITE permite calcular si
-- el taxista debe quedar suspendido: NOW() - penalizacion_pendiente_desde >
-- SUSPENSION_DIAS_LIMITE días Y penalizacion_pendiente > 0.
ALTER TABLE taxistas_perfil
  ADD COLUMN penalizacion_pendiente_desde TIMESTAMPTZ;


-- =============================================================================
-- SECCIÓN 2 — Extensión de pagos
-- =============================================================================

-- Importe realmente capturado cuando una cancelación con penalización parcial
-- usa una captura parcial de Stripe (en vez de capturar el 100% o cancelar al 0%).
-- importe_total NUNCA se modifica: sigue reflejando el precio original pactado
-- con el cliente, dato necesario para resolver cualquier disputa o reclamación.
ALTER TABLE pagos
  ADD COLUMN importe_capturado_real NUMERIC(8,2);


-- =============================================================================
-- SECCIÓN 3 — TABLA: configuracion_penalizaciones_cancelacion
-- =============================================================================
-- Tramos de antelación (horas antes del servicio) que determinan, tanto para la
-- cancelación del CLIENTE como del TAXISTA, qué porcentaje se aplica. Mismo
-- patrón que configuracion_recargos (migración 006): editable desde el panel
-- admin sin tocar código.
--
-- Cada tramo horario tiene DOS valores por concepto: uno para trayectos "dentro
-- de ciudad" y otro para "fuera de ciudad" (sufijos _ciudad / _fuera_ciudad).
-- Un trayecto se clasifica como fuera de ciudad si su duracion_estimada_min
-- (ya calculado por Google Maps al crear la reserva, Ticket 5.1) supera el
-- umbral configurado en la variable de entorno UMBRAL_FUERA_CIUDAD_MINUTOS.
-- Fuera de ciudad puede tener un % MENOR que ciudad en el mismo tramo: es una
-- decisión de negocio deliberada (el importe absoluto ya es mayor, así que un
-- % menor sigue siendo justo con el taxista y más empático con el cliente).
--
-- Conceptos (4 por cada tipo de trayecto, 8 columnas de porcentaje en total):
--   porcentaje_cobro_cliente_*        → % de precio_cliente retenido cuando el
--                                        CLIENTE cancela en este tramo.
--   porcentaje_compensacion_titular_* → % de importe_taxista abonado al taxista
--                                        TITULAR cuando el CLIENTE cancela.
--   porcentaje_penalizacion_taxista_* → % de importe_taxista que PAGA el taxista
--                                        (titular o suplente) cuando es ÉL quien
--                                        cancela una reserva ya aceptada.
--   porcentaje_incentivo_suplente_*   → % simbólico para el taxista SUPLENTE en
--                                        ambos escenarios.
--
-- El caso especial "taxista ya salió" (cliente cancela en tramo 1h-12h pero el
-- taxista ya circula hacia el punto de recogida) NO se modela aquí: es una regla
-- fija aplicada como override en TypeScript (fuerza cobro_cliente=100 y
-- compensacion_titular=100, sea cual sea el tramo o el tipo de trayecto). Ver
-- cancelaciones.service.ts.
-- =============================================================================
CREATE TABLE configuracion_penalizaciones_cancelacion (
  id                                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  horas_desde                                   NUMERIC(5,1) NOT NULL
    CONSTRAINT chk_cpc_horas_desde CHECK (horas_desde >= 0),
  horas_hasta                                   NUMERIC(5,1)
    CONSTRAINT chk_cpc_horas_hasta CHECK (horas_hasta > horas_desde),

  porcentaje_cobro_cliente_ciudad               NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_cc_ciudad CHECK (porcentaje_cobro_cliente_ciudad BETWEEN 0 AND 100),
  porcentaje_cobro_cliente_fuera_ciudad         NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_cc_fuera CHECK (porcentaje_cobro_cliente_fuera_ciudad BETWEEN 0 AND 100),

  porcentaje_compensacion_titular_ciudad        NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_ct_ciudad CHECK (porcentaje_compensacion_titular_ciudad BETWEEN 0 AND 100),
  porcentaje_compensacion_titular_fuera_ciudad  NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_ct_fuera CHECK (porcentaje_compensacion_titular_fuera_ciudad BETWEEN 0 AND 100),

  porcentaje_penalizacion_taxista_ciudad        NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_pt_ciudad CHECK (porcentaje_penalizacion_taxista_ciudad BETWEEN 0 AND 100),
  porcentaje_penalizacion_taxista_fuera_ciudad  NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_pt_fuera CHECK (porcentaje_penalizacion_taxista_fuera_ciudad BETWEEN 0 AND 100),

  porcentaje_incentivo_suplente_ciudad          NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_is_ciudad CHECK (porcentaje_incentivo_suplente_ciudad BETWEEN 0 AND 100),
  porcentaje_incentivo_suplente_fuera_ciudad    NUMERIC(5,2) NOT NULL
    CONSTRAINT chk_cpc_is_fuera CHECK (porcentaje_incentivo_suplente_fuera_ciudad BETWEEN 0 AND 100),

  -- Descripción legible para el panel admin (ej: "Entre 1 y 12 horas de antelación")
  descripcion                                   TEXT         NOT NULL,

  -- Permite desactivar un tramo sin borrarlo (conserva historial de cambios)
  activo                                        BOOLEAN      NOT NULL DEFAULT TRUE,

  created_at                                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                                    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_configuracion_penalizaciones_cancelacion_updated_at
  BEFORE UPDATE ON configuracion_penalizaciones_cancelacion
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- Índice para la consulta más frecuente: encontrar el tramo activo que contiene
-- un número de horas concreto.
CREATE INDEX idx_cpc_horas ON configuracion_penalizaciones_cancelacion (horas_desde, horas_hasta)
  WHERE activo = TRUE;


-- =============================================================================
-- SECCIÓN 4 — Seed de valores PROVISIONALES
-- =============================================================================
-- ATENCIÓN: placeholders razonables para desarrollar y probar el sistema
-- end-to-end. NO son los valores acordados con los taxistas. El ejemplo de
-- "fuera de ciudad con % menor que ciudad" en el tramo 1-12h refleja el caso
-- discutido con el usuario (8€ ciudad cancelado 2h antes → 75%; 40€ fuera de
-- ciudad cancelado 2h antes → 50%).
-- =============================================================================
INSERT INTO configuracion_penalizaciones_cancelacion
  (horas_desde, horas_hasta, descripcion,
   porcentaje_cobro_cliente_ciudad, porcentaje_cobro_cliente_fuera_ciudad,
   porcentaje_compensacion_titular_ciudad, porcentaje_compensacion_titular_fuera_ciudad,
   porcentaje_penalizacion_taxista_ciudad, porcentaje_penalizacion_taxista_fuera_ciudad,
   porcentaje_incentivo_suplente_ciudad, porcentaje_incentivo_suplente_fuera_ciudad)
VALUES
  (48,  NULL, 'PROVISIONAL — 48 horas o más de antelación',
   0.00,  0.00,   0.00,  0.00,   5.00,  5.00,   2.00, 2.00),

  (24,  48,   'PROVISIONAL — Entre 24 y 48 horas de antelación',
   10.00, 8.00,   10.00, 8.00,   10.00, 8.00,   3.00, 3.00),

  (12,  24,   'PROVISIONAL — Entre 12 y 24 horas de antelación',
   25.00, 18.00,  25.00, 18.00,  20.00, 15.00,  5.00, 5.00),

  (1,   12,   'PROVISIONAL — Entre 1 y 12 horas de antelación',
   75.00, 50.00,  75.00, 50.00,  35.00, 25.00,  8.00, 8.00),

  (0,   1,    'PROVISIONAL — Menos de 1 hora / Para Ya! con taxi asignado',
   90.00, 60.00,  90.00, 60.00,  50.00, 35.00,  10.00, 10.00);


-- =============================================================================
-- SECCIÓN 5 — Row Level Security
-- =============================================================================
ALTER TABLE configuracion_penalizaciones_cancelacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publico_lee_penalizaciones_cancelacion_activas" ON configuracion_penalizaciones_cancelacion
  FOR SELECT
  USING (activo = TRUE);

CREATE POLICY "admin_gestiona_penalizaciones_cancelacion" ON configuracion_penalizaciones_cancelacion
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
