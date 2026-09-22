jest.mock("../config/stripe", () => ({
  stripe: {
    accounts: { create: jest.fn(), retrieve: jest.fn() },
    accountLinks: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), capture: jest.fn(), cancel: jest.fn() },
    transfers: { create: jest.fn() },
    refunds: { create: jest.fn() },
  },
}));

import { StripeService } from "./stripe.service";
import { stripe } from "../config/stripe";
import { createQueryBuilder, createSupabaseServiceMock, ok, fail } from "../test-utils/supabase-mock";

const stripeMock = stripe as unknown as {
  accounts: { create: jest.Mock; retrieve: jest.Mock };
  accountLinks: { create: jest.Mock };
  paymentIntents: { create: jest.Mock; capture: jest.Mock; cancel: jest.Mock };
  transfers: { create: jest.Mock };
  refunds: { create: jest.Mock };
};

describe("StripeService", () => {
  let supabaseServiceMock: ReturnType<typeof createSupabaseServiceMock>;
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    supabaseServiceMock = createSupabaseServiceMock();
    service = new StripeService(supabaseServiceMock as any);
  });

  describe("iniciarOnboarding", () => {
    it("crea una cuenta Connect nueva cuando el taxista no tiene ninguna", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // select cuenta existente
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // insert nueva cuenta
      stripeMock.accounts.create.mockResolvedValueOnce({ id: "acct_nuevo" });
      stripeMock.accountLinks.create.mockResolvedValueOnce({ url: "https://stripe.test/onboarding" });

      const resultado = await service.iniciarOnboarding("taxista-1", "https://concompas.app");

      expect(stripeMock.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "express", country: "ES" })
      );
      expect(resultado).toEqual({
        url: "https://stripe.test/onboarding",
        stripe_account_id: "acct_nuevo",
      });
    });

    it("reutiliza la cuenta existente si el onboarding se quedó a medias", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ stripe_account_id: "acct_existente", onboarding_completo: false }))
      );
      stripeMock.accountLinks.create.mockResolvedValueOnce({ url: "https://stripe.test/continuar" });

      const resultado = await service.iniciarOnboarding("taxista-2", "https://concompas.app");

      expect(stripeMock.accounts.create).not.toHaveBeenCalled();
      expect(resultado.stripe_account_id).toBe("acct_existente");
    });

    it("lanza error si el taxista ya completó el onboarding", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ stripe_account_id: "acct_x", onboarding_completo: true }))
      );

      await expect(service.iniciarOnboarding("taxista-3", "https://concompas.app")).rejects.toThrow(
        "El taxista ya ha completado el onboarding de Stripe"
      );
      expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    });
  });

  describe("obtenerEstadoCuenta", () => {
    it("devuelve todo en false si el taxista no tiene cuenta", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok(null)));

      const resultado = await service.obtenerEstadoCuenta("taxista-1");

      expect(resultado).toEqual({
        tiene_cuenta: false,
        stripe_account_id: null,
        onboarding_completo: false,
        payouts_habilitados: false,
      });
    });

    it("mapea el estado real cuando el taxista sí tiene cuenta", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(
          ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true })
        )
      );

      const resultado = await service.obtenerEstadoCuenta("taxista-1");

      expect(resultado).toEqual({
        tiene_cuenta: true,
        stripe_account_id: "acct_1",
        onboarding_completo: true,
        payouts_habilitados: true,
      });
    });
  });

  describe("crearPaymentIntent", () => {
    const trayectoBase = {
      precio_cliente: 25,
      cliente_id: "cliente-1",
      estado: "asignado",
      stripe_payment_intent_id: null,
    };

    it("crea el PaymentIntent y guarda el pago en Supabase", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoBase))) // select trayecto
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // update trayectos
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // insert pagos
      stripeMock.paymentIntents.create.mockResolvedValueOnce({
        id: "pi_1",
        client_secret: "secret_1",
      });

      const resultado = await service.crearPaymentIntent("trayecto-1", "cliente-1");

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2500, currency: "eur", capture_method: "manual" })
      );
      expect(resultado).toEqual({ client_secret: "secret_1", payment_intent_id: "pi_1" });
    });

    it("lanza error si el trayecto no existe", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("no rows")));

      await expect(service.crearPaymentIntent("trayecto-x", "cliente-1")).rejects.toThrow(
        "Trayecto no encontrado"
      );
    });

    it("lanza error si el cliente no es el propietario del trayecto", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ ...trayectoBase, cliente_id: "otro-cliente" }))
      );

      await expect(service.crearPaymentIntent("trayecto-1", "cliente-1")).rejects.toThrow(
        "No tienes permiso sobre este trayecto"
      );
    });

    it("lanza error si el trayecto ya tiene un pago asociado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ ...trayectoBase, stripe_payment_intent_id: "pi_previo" }))
      );

      await expect(service.crearPaymentIntent("trayecto-1", "cliente-1")).rejects.toThrow(
        "Este trayecto ya tiene un pago asociado"
      );
    });

    it.each(["cancelado", "completado"])(
      "lanza error si el trayecto está %s",
      async (estado) => {
        supabaseServiceMock.admin.from.mockReturnValueOnce(
          createQueryBuilder(ok({ ...trayectoBase, estado }))
        );

        await expect(service.crearPaymentIntent("trayecto-1", "cliente-1")).rejects.toThrow(
          "No se puede crear un pago para un trayecto cancelado o completado"
        );
      }
    );
  });

  describe("capturarPagoYTransferir", () => {
    it("captura el pago y transfiere al taxista titular", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(
            ok({ taxista_titular_id: "taxista-1", importe_taxista: 20, stripe_payment_intent_id: "pi_1" })
          )
        )
        .mockReturnValueOnce(
          createQueryBuilder(
            ok({ id: "pago-1", stripe_payment_intent_id: "pi_1", estado: "pendiente", importe_total: 25, importe_taxista: 20 })
          )
        )
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // update pagos
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // insert transferencias_taxista

      stripeMock.paymentIntents.capture.mockResolvedValueOnce({ latest_charge: "ch_1" });
      stripeMock.transfers.create.mockResolvedValueOnce({ id: "tr_1" });

      await service.capturarPagoYTransferir("trayecto-1");

      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_1");
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2000, destination: "acct_1" })
      );
    });

    it("lanza error si el trayecto no tiene pago asociado", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ stripe_payment_intent_id: null })))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      await expect(service.capturarPagoYTransferir("trayecto-1")).rejects.toThrow(
        "El trayecto no tiene pago asociado"
      );
    });

    it("lanza error si el pago ya fue capturado", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ taxista_titular_id: "t1", importe_taxista: 20, stripe_payment_intent_id: "pi_1" }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ id: "pago-1", estado: "capturado" })));

      await expect(service.capturarPagoYTransferir("trayecto-1")).rejects.toThrow(
        "El pago ya fue capturado"
      );
    });

    it("lanza error si no hay taxista titular asignado", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ taxista_titular_id: null, importe_taxista: 20, stripe_payment_intent_id: "pi_1" }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ id: "pago-1", estado: "pendiente" })));

      await expect(service.capturarPagoYTransferir("trayecto-1")).rejects.toThrow(
        "El trayecto no tiene taxista titular asignado"
      );
    });

    it("lanza error si el taxista no completó el onboarding de Stripe", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ taxista_titular_id: "t1", importe_taxista: 20, stripe_payment_intent_id: "pi_1" }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ id: "pago-1", estado: "pendiente" })))
        .mockReturnValueOnce(createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: false })));

      await expect(service.capturarPagoYTransferir("trayecto-1")).rejects.toThrow(
        "El taxista no ha completado el onboarding de Stripe"
      );
    });
  });

  describe("reembolsarPago", () => {
    it("cancela el PaymentIntent si el pago aún no fue capturado", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ id: "pago-1", stripe_payment_intent_id: "pi_1", estado: "pendiente", importe_total: 25 }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      await service.reembolsarPago("trayecto-1");

      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("crea un refund si el pago ya estaba capturado", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ id: "pago-1", stripe_payment_intent_id: "pi_1", estado: "capturado", importe_total: 25 }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      await service.reembolsarPago("trayecto-1", 10);

      expect(stripeMock.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_1",
        amount: 1000,
      });
    });

    it("lanza error si no hay registro de pago", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok(null)));

      await expect(service.reembolsarPago("trayecto-1")).rejects.toThrow(
        "No se encontró el registro de pago para este trayecto"
      );
    });

    it("lanza error si el pago ya fue reembolsado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ id: "pago-1", estado: "reembolsado" }))
      );

      await expect(service.reembolsarPago("trayecto-1")).rejects.toThrow("El pago ya fue reembolsado");
    });

    it("lanza error si el estado del pago no admite reembolso", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ id: "pago-1", estado: "fallido" }))
      );

      await expect(service.reembolsarPago("trayecto-1")).rejects.toThrow(
        "No se puede reembolsar un pago en estado 'fallido'"
      );
    });
  });

  describe("capturarParcialOCancelar", () => {
    it("no hace nada si el trayecto no tiene pago asociado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok(null)));

      await service.capturarParcialOCancelar("trayecto-1", 50);

      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("cancela el PaymentIntent cuando el porcentaje es 0", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ id: "pago-1", stripe_payment_intent_id: "pi_1", estado: "pendiente", importe_total: 8 }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      await service.capturarParcialOCancelar("trayecto-1", 0);

      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
    });

    it("captura el porcentaje indicado y lo guarda en importe_capturado_real", async () => {
      const updateSpy = jest.fn().mockReturnThis();
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok({ id: "pago-1", stripe_payment_intent_id: "pi_1", estado: "pendiente", importe_total: 8 }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      // Ejemplo real de negocio: ciudad, 8€, cancelado con derecho a cobrar 75% → 6€
      await service.capturarParcialOCancelar("trayecto-1", 75);

      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 600 });
    });

    it("lanza error si el pago no está en estado pendiente", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ id: "pago-1", estado: "capturado" }))
      );

      await expect(service.capturarParcialOCancelar("trayecto-1", 50)).rejects.toThrow(
        "No se puede capturar/cancelar un pago en estado 'capturado'"
      );
    });
  });

  describe("retirarIncentivo", () => {
    it("transfiere el importe íntegro con payout estándar", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 20, penalizacion_pendiente: 0 })))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // update taxistas_perfil
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // insert retiros_incentivo
      stripeMock.transfers.create.mockResolvedValueOnce({ id: "tr_1" });

      const resultado = await service.retirarIncentivo("taxista-1", { tipo_payout: "estandar" });

      expect(resultado).toEqual({
        stripe_transfer_id: "tr_1",
        importe_solicitado: 20,
        importe_recibido: 20,
        tipo_payout: "estandar",
      });
    });

    it("descuenta la comisión de Stripe (1%, mín. 0.40€) en payout instantáneo", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 20, penalizacion_pendiente: 0 })))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));
      stripeMock.transfers.create.mockResolvedValueOnce({ id: "tr_1" });

      const resultado = await service.retirarIncentivo("taxista-1", { tipo_payout: "instantaneo" });

      // 20€ - max(20*0.01, 0.40) = 20 - 0.40 = 19.60
      expect(resultado.importe_recibido).toBeCloseTo(19.6);
    });

    it("descuenta las penalizaciones pendientes del importe a transferir", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 20, penalizacion_pendiente: 5 })))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(null)))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));
      stripeMock.transfers.create.mockResolvedValueOnce({ id: "tr_1" });

      const resultado = await service.retirarIncentivo("taxista-1", { tipo_payout: "estandar" });

      expect(resultado.importe_solicitado).toBe(15);
    });

    it("lanza error si no hay saldo disponible y no hay penalizaciones pendientes", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0, penalizacion_pendiente: 0 })))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true }))
        );

      await expect(service.retirarIncentivo("taxista-1", { tipo_payout: "estandar" })).rejects.toThrow(
        "No tienes incentivos acumulados para retirar"
      );
    });

    it("lanza un mensaje distinto si el saldo negativo se debe a penalizaciones", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 5, penalizacion_pendiente: 10 })))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ stripe_account_id: "acct_1", onboarding_completo: true, payouts_habilitados: true }))
        );

      await expect(service.retirarIncentivo("taxista-1", { tipo_payout: "estandar" })).rejects.toThrow(
        "las penalizaciones pendientes superan el incentivo acumulado"
      );
    });

    it("lanza error si el taxista no completó el onboarding de Stripe", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 20, penalizacion_pendiente: 0 })))
        .mockReturnValueOnce(createQueryBuilder(ok({ stripe_account_id: null, onboarding_completo: false })));

      await expect(service.retirarIncentivo("taxista-1", { tipo_payout: "estandar" })).rejects.toThrow(
        "El taxista no ha completado el onboarding de Stripe"
      );
    });
  });

  describe("sincronizarCuentaDesdeWebhook", () => {
    it("marca onboarding_completo true solo si charges_enabled y details_submitted", async () => {
      stripeMock.accounts.retrieve.mockResolvedValueOnce({
        charges_enabled: true,
        details_submitted: true,
        payouts_enabled: true,
      });
      const builder = createQueryBuilder(ok(null));
      supabaseServiceMock.admin.from.mockReturnValueOnce(builder);

      await service.sincronizarCuentaDesdeWebhook("acct_1");

      expect(builder.update).toHaveBeenCalledWith({
        onboarding_completo: true,
        payouts_habilitados: true,
      });
    });

    it("marca onboarding_completo false si falta charges_enabled o details_submitted", async () => {
      stripeMock.accounts.retrieve.mockResolvedValueOnce({
        charges_enabled: false,
        details_submitted: true,
        payouts_enabled: false,
      });
      const builder = createQueryBuilder(ok(null));
      supabaseServiceMock.admin.from.mockReturnValueOnce(builder);

      await service.sincronizarCuentaDesdeWebhook("acct_1");

      expect(builder.update).toHaveBeenCalledWith({
        onboarding_completo: false,
        payouts_habilitados: false,
      });
    });
  });
});
