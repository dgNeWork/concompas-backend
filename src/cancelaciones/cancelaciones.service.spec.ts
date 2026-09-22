import { CancelacionesService } from "./cancelaciones.service";
import { createQueryBuilder, createSupabaseServiceMock, ok, fail } from "../test-utils/supabase-mock";

function tramo(overrides: Record<string, unknown> = {}) {
  return {
    horas_desde: 0,
    horas_hasta: null,
    porcentaje_cobro_cliente_ciudad: 50,
    porcentaje_cobro_cliente_fuera_ciudad: 40,
    porcentaje_compensacion_titular_ciudad: 30,
    porcentaje_compensacion_titular_fuera_ciudad: 20,
    porcentaje_penalizacion_taxista_ciudad: 25,
    porcentaje_penalizacion_taxista_fuera_ciudad: 15,
    porcentaje_incentivo_suplente_ciudad: 10,
    porcentaje_incentivo_suplente_fuera_ciudad: 5,
    activo: true,
    ...overrides,
  };
}

function trayecto(overrides: Record<string, unknown> = {}) {
  return {
    id: "trayecto-1",
    fecha_hora_recogida: new Date(Date.now() + 5 * 3600 * 1000).toISOString(), // 5h de antelación
    duracion_estimada_min: 30, // por debajo del umbral por defecto (90) => ciudad
    hora_salida_estimada_taxista: null as string | null,
    taxista_titular_id: "titular-1",
    taxista_reserva_id: null as string | null,
    importe_taxista: 20,
    ...overrides,
  };
}

describe("CancelacionesService", () => {
  let supabaseServiceMock: ReturnType<typeof createSupabaseServiceMock>;
  let stripeServiceMock: { capturarParcialOCancelar: jest.Mock };
  let service: CancelacionesService;

  beforeEach(() => {
    supabaseServiceMock = createSupabaseServiceMock();
    stripeServiceMock = { capturarParcialOCancelar: jest.fn().mockResolvedValue(undefined) };
    service = new CancelacionesService(supabaseServiceMock as any, stripeServiceMock as any);
  });

  describe("procesarCancelacionCliente", () => {
    it("cobra 0 y no compensa a nadie si el trayecto no tiene taxista titular", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok([tramo()])));

      const resultado = await service.procesarCancelacionCliente(
        trayecto({ taxista_titular_id: null })
      );

      expect(stripeServiceMock.capturarParcialOCancelar).toHaveBeenCalledWith("trayecto-1", 0);
      expect(resultado.porcentajeCobroCliente).toBe(0);
      expect(resultado.porcentajeCompensacionTitular).toBe(0);
      // Solo se consultó el tramo; no se tocó taxistas_perfil
      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(1);
    });

    it("aplica los porcentajes de CIUDAD cuando el trayecto no supera el umbral", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()]))) // tramo
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 }))) // select titular
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // update titular

      const resultado = await service.procesarCancelacionCliente(trayecto());

      expect(resultado.esFueraCiudad).toBe(false);
      expect(resultado.porcentajeCobroCliente).toBe(50);
      expect(resultado.porcentajeCompensacionTitular).toBe(30);
      expect(stripeServiceMock.capturarParcialOCancelar).toHaveBeenCalledWith("trayecto-1", 50);
    });

    it("aplica los porcentajes de FUERA DE CIUDAD cuando supera el umbral configurado", async () => {
      const original = process.env.UMBRAL_FUERA_CIUDAD_MINUTOS;
      process.env.UMBRAL_FUERA_CIUDAD_MINUTOS = "90";

      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()])))
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 })))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      const resultado = await service.procesarCancelacionCliente(
        trayecto({ duracion_estimada_min: 120 })
      );

      expect(resultado.esFueraCiudad).toBe(true);
      expect(resultado.porcentajeCobroCliente).toBe(40);
      expect(resultado.porcentajeCompensacionTitular).toBe(20);

      process.env.UMBRAL_FUERA_CIUDAD_MINUTOS = original;
    });

    it("fuerza cobro y compensación al 100% si el taxista ya había salido", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()])))
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 })))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      const resultado = await service.procesarCancelacionCliente(
        trayecto({ hora_salida_estimada_taxista: new Date(Date.now() - 60_000).toISOString() })
      );

      expect(resultado.taxistaYaSalio).toBe(true);
      expect(resultado.porcentajeCobroCliente).toBe(100);
      expect(resultado.porcentajeCompensacionTitular).toBe(100);
      expect(stripeServiceMock.capturarParcialOCancelar).toHaveBeenCalledWith("trayecto-1", 100);
    });

    it("no aplica el override si hora_salida_estimada_taxista es en el futuro", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()])))
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 })))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      const resultado = await service.procesarCancelacionCliente(
        trayecto({ hora_salida_estimada_taxista: new Date(Date.now() + 3_600_000).toISOString() })
      );

      expect(resultado.taxistaYaSalio).toBe(false);
      expect(resultado.porcentajeCobroCliente).toBe(50);
    });

    it("incrementa también el incentivo del suplente cuando existe y el porcentaje es > 0", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()]))) // tramo
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 }))) // select titular
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // update titular
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 3 }))) // select suplente
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // update suplente

      await service.procesarCancelacionCliente(trayecto({ taxista_reserva_id: "suplente-1" }));

      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(5);
    });

    it("no toca al suplente si el incentivo del tramo es 0", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo({ porcentaje_incentivo_suplente_ciudad: 0 })])))
        .mockReturnValueOnce(createQueryBuilder(ok({ incentivo_acumulado: 0 })))
        .mockReturnValueOnce(createQueryBuilder(ok(null)));

      await service.procesarCancelacionCliente(trayecto({ taxista_reserva_id: "suplente-1" }));

      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(3);
    });

    it("lanza error si no hay tramos de penalización configurados", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok([])));

      await expect(service.procesarCancelacionCliente(trayecto())).rejects.toThrow(
        "No hay tramos de penalización por cancelación configurados"
      );
    });

    it("lanza error si ningún tramo cubre las horas de antelación calculadas", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok([tramo({ horas_desde: 100, horas_hasta: 200 })]))
      );

      await expect(service.procesarCancelacionCliente(trayecto())).rejects.toThrow(
        /No se encontró un tramo de penalización/
      );
    });
  });

  describe("procesarCancelacionTaxista", () => {
    it("registra la penalización y actualiza penalizacion_pendiente cuando el importe es > 0", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok([tramo()]))) // tramo
        .mockReturnValueOnce(createQueryBuilder(ok(null))) // insert penalizaciones_taxista
        .mockReturnValueOnce(createQueryBuilder(ok({ penalizacion_pendiente: 0 }))) // select taxistas_perfil
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // update taxistas_perfil

      const resultado = await service.procesarCancelacionTaxista(trayecto(), "titular-1");

      expect(resultado.importePenalizacion).toBeGreaterThan(0);
      expect(supabaseServiceMock.admin.from).toHaveBeenNthCalledWith(2, "penalizaciones_taxista");
    });

    it("no registra nada si el porcentaje de penalización del tramo es 0", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(
          ok([tramo({ porcentaje_penalizacion_taxista_ciudad: 0 })])
        )
      );

      const resultado = await service.procesarCancelacionTaxista(trayecto(), "titular-1");

      expect(resultado.importePenalizacion).toBe(0);
      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(1);
    });
  });

  describe("justificarPenalizacion", () => {
    const penalizacionPendiente = {
      id: "pen-1",
      taxista_id: "taxista-1",
      estado: "pendiente",
    };

    it("guarda la justificación cuando la penalización es del taxista y está pendiente", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(penalizacionPendiente)))
        .mockReturnValueOnce(
          createQueryBuilder(
            ok({ ...penalizacionPendiente, justificacion: "Parte médico adjunto" })
          )
        );

      const resultado = await service.justificarPenalizacion("pen-1", "taxista-1", {
        justificacion: "Parte médico adjunto",
      });

      expect(resultado.justificacion).toBe("Parte médico adjunto");
    });

    it("lanza error si la penalización no existe", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(
        service.justificarPenalizacion("pen-x", "taxista-1", { justificacion: "..." })
      ).rejects.toThrow("Penalización no encontrada");
    });

    it("lanza error si el taxista no es el dueño de la penalización", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok(penalizacionPendiente)));

      await expect(
        service.justificarPenalizacion("pen-1", "otro-taxista", { justificacion: "..." })
      ).rejects.toThrow("No tienes permiso para justificar esta penalización");
    });

    it("lanza error si la penalización ya no está pendiente", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ ...penalizacionPendiente, estado: "descontada" }))
      );

      await expect(
        service.justificarPenalizacion("pen-1", "taxista-1", { justificacion: "..." })
      ).rejects.toThrow("Solo se puede justificar una penalización en estado pendiente");
    });
  });

  describe("resolverPenalizacion", () => {
    const penalizacionPendiente = {
      id: "pen-1",
      taxista_id: "taxista-1",
      importe: 5,
      estado: "pendiente",
    };

    it("marca la penalización como 'descontada' sin tocar penalizacion_pendiente", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(penalizacionPendiente)))
        .mockReturnValueOnce(createQueryBuilder(ok({ ...penalizacionPendiente, estado: "descontada" })));

      await service.resolverPenalizacion("pen-1", { estado: "descontada" });

      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(2);
    });

    it("decrementa penalizacion_pendiente cuando se cancela con justificación", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(penalizacionPendiente)))
        .mockReturnValueOnce(
          createQueryBuilder(ok({ ...penalizacionPendiente, estado: "cancelada_con_justificacion" }))
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ penalizacion_pendiente: 5 }))) // select taxistas_perfil
        .mockReturnValueOnce(createQueryBuilder(ok(null))); // update taxistas_perfil

      await service.resolverPenalizacion("pen-1", { estado: "cancelada_con_justificacion" });

      expect(supabaseServiceMock.admin.from).toHaveBeenCalledTimes(4);
    });

    it("lanza error si la penalización ya fue resuelta", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ ...penalizacionPendiente, estado: "descontada" }))
      );

      await expect(
        service.resolverPenalizacion("pen-1", { estado: "descontada" })
      ).rejects.toThrow("Esta penalización ya fue resuelta");
    });

    it("lanza error si la penalización no existe", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(
        service.resolverPenalizacion("pen-x", { estado: "descontada" })
      ).rejects.toThrow("Penalización no encontrada");
    });
  });

  describe("listarPenalizacionesTaxista", () => {
    it("mapea la lista de penalizaciones del taxista", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(
          ok([
            {
              id: "pen-1",
              taxista_id: "taxista-1",
              trayecto_id: "trayecto-1",
              importe: 5,
              horas_antes_servicio: 2,
              estado: "pendiente",
              justificacion: null,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ])
        )
      );

      const resultado = await service.listarPenalizacionesTaxista("taxista-1");

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe("pen-1");
    });
  });

  describe("verificarSuspension", () => {
    it("no lanza error si no hay penalización pendiente", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok({ penalizacion_pendiente: 0, penalizacion_pendiente_desde: null }))
      );

      await expect(service.verificarSuspension("taxista-1")).resolves.toBeUndefined();
    });

    it("no lanza error si la penalización pendiente lleva menos días que el límite", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(
          ok({
            penalizacion_pendiente: 5,
            penalizacion_pendiente_desde: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
          })
        )
      );

      await expect(service.verificarSuspension("taxista-1")).resolves.toBeUndefined();
    });

    it("lanza error si la penalización pendiente supera el límite de días configurado", async () => {
      const original = process.env.SUSPENSION_DIAS_LIMITE;
      process.env.SUSPENSION_DIAS_LIMITE = "7";

      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(
          ok({
            penalizacion_pendiente: 5,
            penalizacion_pendiente_desde: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
          })
        )
      );

      await expect(service.verificarSuspension("taxista-1")).rejects.toThrow(
        "Cuenta suspendida por impago de penalizaciones pendientes desde hace más de 7 días"
      );

      process.env.SUSPENSION_DIAS_LIMITE = original;
    });

    it("lanza error si no se encuentra el perfil del taxista", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(service.verificarSuspension("taxista-x")).rejects.toThrow(
        "Perfil de taxista no encontrado"
      );
    });
  });
});
