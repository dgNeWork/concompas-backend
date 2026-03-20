-- =============================================================================
-- MIGRACIÓN 005 — Integración Stripe: pagos y transferencias
-- =============================================================================
-- Gestiona todo el flujo económico de la plataforma.
--
-- Flujo de un pago en ConCompas:
--   1. El cliente confirma la reserva → se crea un PaymentIntent en Stripe
--      (el dinero queda retenido, pero no capturado todavía).
--   2. El servicio se completa → la plataforma captura el pago y registra
--      el cobro en la tabla 'pagos'.
--   3. La plataforma transfiere el importe del taxista a su cuenta Stripe
--      Connect → se registra en 'transferencias_taxista'.
--   4. Stripe gestiona el payout final al banco del taxista (instantáneo
--      si está habilitado, o en el ciclo normal de Stripe).
--
-- Si el servicio se cancela antes de completarse, el PaymentIntent se cancela
-- o se reembolsa dependiendo del estado en que se encuentre.
--
-- Estructura:
--   taxistas_stripe_cuenta  → cuenta Stripe Connect de cada taxista
--   pagos                   → registro de cada cobro al cliente
--   transferencias_taxista  → registro de cada pago al taxista
--
-- Depende de: migraciones 001, 002, 003 y 004
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TIPO: estado_pago
-- Ciclo de vida de un pago desde que se crea el PaymentIntent hasta que
-- el dinero está disponible o devuelto.
-- -----------------------------------------------------------------------------
CREATE TYPE estado_pago AS ENUM (
  'pendiente',    -- PaymentIntent creado, dinero retenido pero no capturado
  'capturado',    -- Pago confirmado y capturado al completarse el servicio
  'reembolsado',  -- Dinero devuelto al cliente (cancelación)
  'fallido'       -- El pago no pudo procesarse (tarjeta rechazada, etc.)
);


-- -----------------------------------------------------------------------------
-- TIPO: estado_transferencia
-- Ciclo de vida de la transferencia del dinero al taxista.
-- -----------------------------------------------------------------------------
CREATE TYPE estado_transferencia AS ENUM (
  'pendiente',    -- Transferencia pendiente de ejecutar
  'completada',   -- Dinero transferido a la cuenta Connect del taxista
  'fallida'       -- La transferencia falló (cuenta no válida, fondos insuficientes, etc.)
);


-- -----------------------------------------------------------------------------
-- TABLA: taxistas_stripe_cuenta
-- Almacena la vinculación entre cada taxista y su cuenta Stripe Connect.
-- El taxista debe completar el onboarding de Stripe antes de poder recibir
-- pagos. Sin cuenta Connect activa, el sistema no le asignará servicios.
-- -----------------------------------------------------------------------------
CREATE TABLE taxistas_stripe_cuenta (
  -- Usamos el profile_id del taxista como PK para garantizar relación 1:1
  taxista_id              UUID          PRIMARY KEY REFERENCES taxistas_perfil(profile_id),

  -- ID de la cuenta Connect en Stripe (formato: acct_XXXXXXXXXXXXXXXXXX)
  stripe_account_id       TEXT          NOT NULL UNIQUE,

  -- Indica si el taxista ha completado el formulario de onboarding de Stripe.
  -- Hasta que no sea TRUE, no puede recibir transferencias.
  onboarding_completo     BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Indica si Stripe tiene habilitados los pagos instantáneos para esta cuenta.
  -- Depende de que el taxista haya configurado una tarjeta de débito en Stripe.
  payouts_habilitados     BOOLEAN       NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_taxistas_stripe_updated_at
  BEFORE UPDATE ON taxistas_stripe_cuenta
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();


-- -----------------------------------------------------------------------------
-- TABLA: pagos
-- Registra cada cobro realizado al cliente.
-- Un pago corresponde siempre a un único servicio: o un trayecto concertado
-- o una reserva de tour. Exactamente uno de los dos campos de FK estará
-- relleno; el CHECK constraint lo garantiza a nivel de base de datos.
-- -----------------------------------------------------------------------------
CREATE TABLE pagos (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cliente que realizó el pago
  cliente_id                UUID          NOT NULL REFERENCES clientes_perfil(profile_id),

  -- Referencia al servicio pagado. Solo uno de los dos puede estar relleno.
  trayecto_id               UUID          REFERENCES trayectos(id),
  reserva_tour_id           UUID          REFERENCES reservas_tour(id),

  -- Garantiza que el pago está vinculado a exactamente un servicio
  CONSTRAINT chk_pago_un_servicio CHECK (
    (trayecto_id IS NOT NULL AND reserva_tour_id IS NULL)
    OR
    (trayecto_id IS NULL AND reserva_tour_id IS NOT NULL)
  ),

  -- ID del PaymentIntent en Stripe. Es el identificador principal para
  -- consultar el estado del pago directamente en la API de Stripe.
  stripe_payment_intent_id  TEXT          NOT NULL UNIQUE,

  -- ID del Charge generado al capturar el PaymentIntent.
  -- Se rellena solo cuando el estado pasa a 'capturado'.
  stripe_charge_id          TEXT          UNIQUE,

  -- Estado actual del pago (ver tipo estado_pago arriba)
  estado                    estado_pago   NOT NULL DEFAULT 'pendiente',

  -- Importes económicos del servicio, guardados aquí como registro histórico.
  -- Aunque estos datos también están en trayectos/reservas_tour, los duplicamos
  -- porque son datos financieros y deben ser inmutables una vez capturado el pago.
  importe_total             NUMERIC(8,2)  NOT NULL
    CONSTRAINT chk_importe_total CHECK (importe_total > 0),
  comision_plataforma       NUMERIC(8,2)  NOT NULL DEFAULT 0.00,
  importe_taxista           NUMERIC(8,2)  NOT NULL,

  -- Fecha en que se capturó el pago. NULL mientras esté pendiente.
  capturado_at              TIMESTAMPTZ,

  -- Fecha en que se reembolsó el pago, si aplica.
  reembolsado_at            TIMESTAMPTZ,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_pagos_updated_at
  BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE INDEX idx_pagos_cliente         ON pagos (cliente_id);
CREATE INDEX idx_pagos_trayecto        ON pagos (trayecto_id);
CREATE INDEX idx_pagos_reserva_tour    ON pagos (reserva_tour_id);
CREATE INDEX idx_pagos_estado          ON pagos (estado);


-- -----------------------------------------------------------------------------
-- TABLA: transferencias_taxista
-- Registra cada transferencia de dinero desde la plataforma a la cuenta
-- Stripe Connect del taxista, una vez completado el servicio.
-- Una transferencia corresponde siempre a un único pago capturado.
-- -----------------------------------------------------------------------------
CREATE TABLE transferencias_taxista (
  id                      UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Taxista que recibe la transferencia
  taxista_id              UUID                  NOT NULL REFERENCES taxistas_perfil(profile_id),

  -- Pago del que proviene esta transferencia
  pago_id                 UUID                  NOT NULL UNIQUE REFERENCES pagos(id),

  -- ID de la transferencia en Stripe (formato: tr_XXXXXXXXXXXXXXXXXX).
  -- Se rellena cuando Stripe confirma que la transferencia se ha creado.
  stripe_transfer_id      TEXT                  UNIQUE,

  -- Estado de la transferencia (ver tipo estado_transferencia arriba)
  estado                  estado_transferencia  NOT NULL DEFAULT 'pendiente',

  -- Importe transferido al taxista (equivale a pagos.importe_taxista)
  importe                 NUMERIC(8,2)          NOT NULL
    CONSTRAINT chk_importe_transferencia CHECK (importe > 0),

  -- Fecha en que la transferencia se completó. NULL mientras esté pendiente.
  completada_at           TIMESTAMPTZ,

  created_at              TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_transferencias_updated_at
  BEFORE UPDATE ON transferencias_taxista
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE INDEX idx_transferencias_taxista  ON transferencias_taxista (taxista_id);
CREATE INDEX idx_transferencias_estado   ON transferencias_taxista (estado);


-- =============================================================================
-- SEGURIDAD: Row Level Security
-- =============================================================================

-- --- taxistas_stripe_cuenta ---
ALTER TABLE taxistas_stripe_cuenta ENABLE ROW LEVEL SECURITY;

-- El taxista puede ver su propia cuenta Stripe
CREATE POLICY "taxista_su_cuenta_stripe" ON taxistas_stripe_cuenta
  FOR SELECT
  USING (auth.uid() = taxista_id);

-- El taxista puede actualizar su propia cuenta (ej. cuando completa el onboarding)
CREATE POLICY "taxista_actualiza_su_cuenta_stripe" ON taxistas_stripe_cuenta
  FOR UPDATE
  USING (auth.uid() = taxista_id);

-- El admin puede crear cuentas Stripe de taxistas y tiene acceso total
-- (INSERT, DELETE y visibilidad completa). El UPDATE del taxista sobre
-- su propia cuenta coexiste con esta policy sin conflicto.
CREATE POLICY "admin_gestiona_cuentas_stripe" ON taxistas_stripe_cuenta
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- pagos ---
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- El cliente puede ver sus propios pagos
CREATE POLICY "cliente_sus_pagos" ON pagos
  FOR SELECT
  USING (auth.uid() = cliente_id);

-- El taxista puede ver los pagos de los servicios que ha realizado.
-- Comprobamos tanto trayectos como reservas_tour para cubrir ambos tipos.
CREATE POLICY "taxista_pagos_sus_servicios" ON pagos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trayectos t
      WHERE t.id = trayecto_id
        AND (auth.uid() = t.taxista_titular_id OR auth.uid() = t.taxista_reserva_id)
    )
    OR
    EXISTS (
      SELECT 1 FROM reservas_tour rt
      WHERE rt.id = reserva_tour_id
        AND (auth.uid() = rt.taxista_id OR auth.uid() = rt.taxista_reserva_id)
    )
  );

-- El admin gestiona todos los pagos
CREATE POLICY "admin_gestiona_pagos" ON pagos
  FOR ALL
  USING (obtener_rol_actual() = 'admin');


-- --- transferencias_taxista ---
ALTER TABLE transferencias_taxista ENABLE ROW LEVEL SECURITY;

-- El taxista puede ver sus propias transferencias
CREATE POLICY "taxista_sus_transferencias" ON transferencias_taxista
  FOR SELECT
  USING (auth.uid() = taxista_id);

-- El admin gestiona todas las transferencias
CREATE POLICY "admin_gestiona_transferencias" ON transferencias_taxista
  FOR ALL
  USING (obtener_rol_actual() = 'admin');
