import { TrayectosService } from "./trayectos.service";
import { CrearTrayectoInput, AceptarTrayectoInput, CambiarEstadoInput } from "./dto/trayectos.dto";
import { createQueryBuilder, createSupabaseServiceMock, ok, fail } from "../test-utils/supabase-mock";

function trayectoRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: "trayecto-1",
    cliente_id: "cliente-1",
    taxista_titular_id: null,
    taxista_reserva_id: null,
    vehiculo_id: null,
    estado: "pendiente",
    origen_texto: "Calle Larga 10, Jerez de la Frontera",
    destino_texto: "Aeropuerto de Jerez",
    fecha_hora_recogida: "2026-06-10T09:00:00Z",
    duracion_estimada_min: 20,
    tipo_reserva: "ida",
    tipo_punto_origen: "normal",
    tipo_punto_destino: "normal",
    precio_cliente: 25,
    comision_plataforma: 5,
    importe_taxista: 20,
    recargo_antelacion_porcentaje: 0,
    hora_salida_estimada_taxista: null,
    notas_cliente: null,
    motivo_cancelacion: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TrayectosService", () => {
  let supabaseServiceMock: ReturnType<typeof createSupabaseServiceMock>;
  let mapsServiceMock: { calcularTrayecto: jest.Mock; calcularHoraSalida: jest.Mock };
  let stripeServiceMock: { capturarPagoYTransferir: jest.Mock };
  let cancelacionesServiceMock: {
    verificarSuspension: jest.Mock;
    procesarCancelacionCliente: jest.Mock;
    procesarCancelacionTaxista: jest.Mock;
  };
  let service: TrayectosService;

  beforeEach(() => {
    supabaseServiceMock = createSupabaseServiceMock();
    mapsServiceMock = { calcularTrayecto: jest.fn(), calcularHoraSalida: jest.fn() };
    stripeServiceMock = { capturarPagoYTransferir: jest.fn().mockResolvedValue(undefined) };
    cancelacionesServiceMock = {
      verificarSuspension: jest.fn().mockResolvedValue(undefined),
      procesarCancelacionCliente: jest.fn().mockResolvedValue(undefined),
      procesarCancelacionTaxista: jest.fn().mockResolvedValue(undefined),
    };
    service = new TrayectosService(
      supabaseServiceMock as any,
      mapsServiceMock as any,
      stripeServiceMock as any,
      cancelacionesServiceMock as any
    );
  });

  const crearTrayectoDto: CrearTrayectoInput = {
    origen_texto: "Calle Larga 10, Jerez de la Frontera",
    origen_lat: 36.686,
    origen_lng: -6.137,
    destino_texto: "Aeropuerto de Jerez",
    destino_lat: 36.744,
    destino_lng: -6.06,
    fecha_hora_recogida: "2026-06-10T09:00:00.000Z",
    tipo_reserva: "ida",
    tipo_punto_origen: "normal",
    tipo_punto_destino: "aeropuerto",
    precio_cliente: 25,
    comision_plataforma: 5,
    importe_taxista: 20,
  };

  describe("crearTrayecto", () => {
    it("calcula la duración con Google Maps y crea el trayecto", async () => {
      mapsServiceMock.calcularTrayecto.mockResolvedValueOnce({
        distancia_metros: 12000,
        distancia_texto: "12 km",
        duracion_segundos: 1200,
        duracion_texto: "20 mins",
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw())));

      const resultado = await service.crearTrayecto("cliente-1", crearTrayectoDto);

      expect(resultado.duracion_estimada_min).toBe(20);
      expect(resultado.id).toBe("trayecto-1");
    });

    it("crea el trayecto sin duración si Google Maps falla", async () => {
      mapsServiceMock.calcularTrayecto.mockRejectedValueOnce(new Error("API caída"));
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ duracion_estimada_min: null })))
      );

      const resultado = await service.crearTrayecto("cliente-1", crearTrayectoDto);

      expect(resultado.duracion_estimada_min).toBeNull();
    });

    it("lanza error si Supabase falla al insertar", async () => {
      mapsServiceMock.calcularTrayecto.mockResolvedValueOnce({
        distancia_metros: 1,
        distancia_texto: "1 m",
        duracion_segundos: 1,
        duracion_texto: "1 s",
      });
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("constraint violada")));

      await expect(service.crearTrayecto("cliente-1", crearTrayectoDto)).rejects.toThrow(
        "Error al crear el trayecto: constraint violada"
      );
    });
  });

  describe("listarTrayectos", () => {
    it("cliente: lista solo sus propios trayectos", async () => {
      const builder = createQueryBuilder(ok([trayectoRaw()]));
      supabaseServiceMock.admin.from.mockReturnValueOnce(builder);

      const resultado = await service.listarTrayectos("cliente-1", "cliente");

      expect(supabaseServiceMock.admin.from).toHaveBeenCalledWith("trayectos");
      expect(builder.eq).toHaveBeenCalledWith("cliente_id", "cliente-1");
      expect(resultado).toHaveLength(1);
    });

    it("admin: lista todos los trayectos sin filtro", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(ok([trayectoRaw()]) as any);
      const builder = createQueryBuilder(ok([trayectoRaw(), trayectoRaw({ id: "trayecto-2" })]));
      supabaseServiceMock.admin.from.mockReset();
      supabaseServiceMock.admin.from.mockReturnValueOnce(builder);

      const resultado = await service.listarTrayectos("admin-1", "admin");

      expect(resultado).toHaveLength(2);
    });

    describe("taxista", () => {
      it("lanza error si el taxista no tiene municipio de licencia", async () => {
        supabaseServiceMock.admin.from.mockReturnValueOnce(
          createQueryBuilder(ok({ municipio_licencia: null }))
        );

        await expect(service.listarTrayectos("taxista-1", "taxista")).rejects.toThrow(
          "No se encontró el municipio de licencia del taxista"
        );
      });

      it("filtra por municipio de origen en el caso normal", async () => {
        supabaseServiceMock.admin.from
          .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })))
          .mockReturnValueOnce(
            createQueryBuilder(
              ok([
                trayectoRaw({ id: "t-jerez", origen_texto: "Calle Larga 10, Jerez de la Frontera" }),
                trayectoRaw({ id: "t-cadiz", origen_texto: "Plaza San Juan de Dios, Cádiz" }),
              ])
            )
          )
          .mockReturnValueOnce(createQueryBuilder(ok([]))); // sin eventos especiales activos

        const resultado = await service.listarTrayectos("taxista-1", "taxista");

        expect(resultado.map((t) => t.id)).toEqual(["t-jerez"]);
      });

      it("usa el municipio de DESTINO cuando el origen es aeropuerto o muelle", async () => {
        supabaseServiceMock.admin.from
          .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })))
          .mockReturnValueOnce(
            createQueryBuilder(
              ok([
                trayectoRaw({
                  id: "t-aeropuerto",
                  tipo_punto_origen: "aeropuerto",
                  origen_texto: "Aeropuerto de Sevilla",
                  destino_texto: "Calle Larga, Jerez de la Frontera",
                }),
              ])
            )
          )
          .mockReturnValueOnce(createQueryBuilder(ok([])));

        const resultado = await service.listarTrayectos("taxista-1", "taxista");

        expect(resultado).toHaveLength(1);
        expect(resultado[0].id).toBe("t-aeropuerto");
      });

      it("ignora la restricción de municipio si la fecha cae en un evento especial activo", async () => {
        supabaseServiceMock.admin.from
          .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Chiclana de la Frontera" })))
          .mockReturnValueOnce(
            createQueryBuilder(
              ok([
                trayectoRaw({
                  id: "t-feria",
                  origen_texto: "Plaza del Arenal, Jerez de la Frontera",
                  fecha_hora_recogida: "2026-05-10T10:00:00Z",
                }),
              ])
            )
          )
          .mockReturnValueOnce(
            createQueryBuilder(
              ok([{ fecha_inicio: "2026-05-01", fecha_fin: "2026-05-15" }])
            )
          );

        const resultado = await service.listarTrayectos("taxista-1", "taxista");

        expect(resultado).toHaveLength(1);
      });
    });
  });

  describe("obtenerTrayecto", () => {
    it("lanza error si el trayecto no existe", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(createQueryBuilder(fail("not found")));

      await expect(service.obtenerTrayecto("t-x", "cliente-1", "cliente")).rejects.toThrow(
        "Trayecto no encontrado"
      );
    });

    it("permite al cliente ver su propio trayecto", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "cliente-1" })))
      );

      await expect(
        service.obtenerTrayecto("trayecto-1", "cliente-1", "cliente")
      ).resolves.toMatchObject({ id: "trayecto-1" });
    });

    it("no permite a un cliente ver el trayecto de otro cliente", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "otro-cliente" })))
      );

      await expect(service.obtenerTrayecto("trayecto-1", "cliente-1", "cliente")).rejects.toThrow(
        "No tienes permiso para ver este trayecto"
      );
    });

    it("el admin puede ver cualquier trayecto", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "cualquiera" })))
      );

      await expect(
        service.obtenerTrayecto("trayecto-1", "admin-1", "admin")
      ).resolves.toMatchObject({ id: "trayecto-1" });
    });
  });

  describe("aceptarTrayecto", () => {
    const aceptarDto: AceptarTrayectoInput = {};

    it("el primer taxista en aceptar entra como titular y calcula la hora de salida", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "pendiente" })))) // trayecto
        .mockReturnValueOnce(
          createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" }))
        ) // perfil taxista
        .mockReturnValueOnce(createQueryBuilder(ok([]))) // eventos especiales (elegibilidad)
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(
              trayectoRaw({
                estado: "asignado",
                taxista_titular_id: "taxista-1",
                hora_salida_estimada_taxista: "2026-06-10T08:30:00.000Z",
              })
            )
          )
        ); // update

      mapsServiceMock.calcularHoraSalida.mockResolvedValueOnce(new Date("2026-06-10T08:30:00.000Z"));

      const resultado = await service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto);

      expect(resultado.taxista_titular_id).toBe("taxista-1");
      expect(cancelacionesServiceMock.verificarSuspension).toHaveBeenCalledWith("taxista-1");
    });

    it("el segundo taxista en aceptar entra como suplente sin recalcular la hora de salida", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(trayectoRaw({ estado: "asignado", taxista_titular_id: "titular-1" }))
          )
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })))
        .mockReturnValueOnce(createQueryBuilder(ok([])))
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(
              trayectoRaw({
                estado: "asignado",
                taxista_titular_id: "titular-1",
                taxista_reserva_id: "suplente-1",
              })
            )
          )
        );

      const resultado = await service.aceptarTrayecto("trayecto-1", "suplente-1", aceptarDto);

      expect(resultado.taxista_reserva_id).toBe("suplente-1");
      expect(mapsServiceMock.calcularHoraSalida).not.toHaveBeenCalled();
    });

    it("lanza error si el trayecto no existe", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(fail("not found")))
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez" })));

      await expect(service.aceptarTrayecto("t-x", "taxista-1", aceptarDto)).rejects.toThrow(
        "Trayecto no encontrado"
      );
    });

    it("lanza error si el taxista tiene penalizaciones que lo suspenden", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw())))
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })));
      cancelacionesServiceMock.verificarSuspension.mockRejectedValueOnce(
        new Error("Cuenta suspendida por impago de penalizaciones pendientes desde hace más de 7 días")
      );

      await expect(service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto)).rejects.toThrow(
        "Cuenta suspendida"
      );
    });

    it("lanza error si el trayecto ya no admite más taxistas", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "en_curso" }))))
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })));

      await expect(service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto)).rejects.toThrow(
        "Este trayecto ya no admite más taxistas"
      );
    });

    it("lanza error si el taxista ya está asignado a este trayecto", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ taxista_titular_id: "taxista-1" }))))
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })));

      await expect(service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto)).rejects.toThrow(
        "Ya estás asignado a este trayecto"
      );
    });

    it("lanza error si ya hay titular y suplente asignados", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(trayectoRaw({ taxista_titular_id: "titular-1", taxista_reserva_id: "suplente-1" }))
          )
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })))
        .mockReturnValueOnce(createQueryBuilder(ok([])));

      await expect(service.aceptarTrayecto("trayecto-1", "otro-taxista", aceptarDto)).rejects.toThrow(
        "Este trayecto ya tiene titular y suplente asignados"
      );
    });

    it("lanza error si el municipio del taxista no coincide y no hay evento especial activo", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ origen_texto: "Calle Larga, Jerez de la Frontera" })))
        )
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Cádiz" })))
        .mockReturnValueOnce(createQueryBuilder(ok([])));

      await expect(service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto)).rejects.toThrow(
        /Tu municipio de licencia/
      );
    });

    it("continúa sin hora_salida_estimada_taxista si Google Maps falla al aceptar", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw())))
        .mockReturnValueOnce(createQueryBuilder(ok({ municipio_licencia: "Jerez de la Frontera" })))
        .mockReturnValueOnce(createQueryBuilder(ok([])))
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ estado: "asignado", taxista_titular_id: "taxista-1" })))
        );
      mapsServiceMock.calcularHoraSalida.mockRejectedValueOnce(new Error("API caída"));

      const resultado = await service.aceptarTrayecto("trayecto-1", "taxista-1", aceptarDto);

      expect(resultado.taxista_titular_id).toBe("taxista-1");
    });
  });

  describe("cambiarEstado", () => {
    const cancelarDto: CambiarEstadoInput = { estado: "cancelado", motivo_cancelacion: "Ya no lo necesito" };

    it("el cliente puede cancelar su propio trayecto pendiente", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ cliente_id: "cliente-1" }))))
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "cancelado" }))));

      await service.cambiarEstado("trayecto-1", "cliente-1", "cliente", cancelarDto);

      expect(cancelacionesServiceMock.procesarCancelacionCliente).toHaveBeenCalled();
    });

    it("el cliente no puede cambiar a un estado distinto de cancelado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "cliente-1" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "cliente-1", "cliente", { estado: "completado" })
      ).rejects.toThrow("El cliente solo puede cancelar trayectos");
    });

    it("el cliente no puede cancelar un trayecto ya en curso o completado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "cliente-1", estado: "en_curso" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "cliente-1", "cliente", cancelarDto)
      ).rejects.toThrow("No se puede cancelar un trayecto que ya está en curso o completado");
    });

    it("el cliente no puede cancelar el trayecto de otro cliente", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "otro-cliente" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "cliente-1", "cliente", cancelarDto)
      ).rejects.toThrow("No tienes permiso para cancelar este trayecto");
    });

    it("exige motivo_cancelacion al cancelar", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ cliente_id: "cliente-1" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "cliente-1", "cliente", { estado: "cancelado" })
      ).rejects.toThrow("El motivo de cancelación es obligatorio");
    });

    it("solo el taxista titular puede cambiar el estado", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ estado: "asignado", taxista_titular_id: "titular-1" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "suplente-1", "taxista", { estado: "en_curso" })
      ).rejects.toThrow("Solo el taxista titular puede cambiar el estado del trayecto");
    });

    it("no permite transiciones inválidas para el taxista titular", async () => {
      supabaseServiceMock.admin.from.mockReturnValueOnce(
        createQueryBuilder(ok(trayectoRaw({ estado: "pendiente", taxista_titular_id: "titular-1" })))
      );

      await expect(
        service.cambiarEstado("trayecto-1", "titular-1", "taxista", { estado: "en_curso" })
      ).rejects.toThrow("No se puede pasar de 'pendiente' a 'en_curso'");
    });

    it("el titular puede pasar de asignado a en_curso", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ estado: "asignado", taxista_titular_id: "titular-1" })))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "en_curso" }))));

      await expect(
        service.cambiarEstado("trayecto-1", "titular-1", "taxista", { estado: "en_curso" })
      ).resolves.toMatchObject({ estado: "en_curso" });
    });

    it("cuando el titular cancela, el suplente pasa a titular y queda en 'asignado'", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(
              trayectoRaw({
                estado: "asignado",
                taxista_titular_id: "titular-1",
                taxista_reserva_id: "suplente-1",
              })
            )
          )
        )
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "asignado" }))));

      await service.cambiarEstado("trayecto-1", "titular-1", "taxista", cancelarDto);

      expect(cancelacionesServiceMock.procesarCancelacionTaxista).toHaveBeenCalledWith(
        expect.objectContaining({ id: "trayecto-1" }),
        "titular-1"
      );
      const updateBuilder = supabaseServiceMock.admin.from.mock.results[1].value;
      expect(updateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          taxista_titular_id: "suplente-1",
          taxista_reserva_id: null,
          estado: "asignado",
        })
      );
    });

    it("cuando el titular cancela sin suplente, el trayecto vuelve a 'pendiente'", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ estado: "asignado", taxista_titular_id: "titular-1" })))
        )
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "pendiente" }))));

      await service.cambiarEstado("trayecto-1", "titular-1", "taxista", cancelarDto);

      const updateBuilder = supabaseServiceMock.admin.from.mock.results[1].value;
      expect(updateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ taxista_titular_id: null, estado: "pendiente" })
      );
    });

    it("el admin puede realizar cualquier transición", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "pendiente" }))))
        .mockReturnValueOnce(createQueryBuilder(ok(trayectoRaw({ estado: "cancelado" }))));

      await expect(
        service.cambiarEstado("trayecto-1", "admin-1", "admin", cancelarDto)
      ).resolves.toMatchObject({ estado: "cancelado" });
      expect(cancelacionesServiceMock.procesarCancelacionCliente).not.toHaveBeenCalled();
    });

    it("al completar con pago asociado, captura y transfiere vía Stripe", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ estado: "en_curso", taxista_titular_id: "titular-1" })))
        )
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(trayectoRaw({ estado: "completado", stripe_payment_intent_id: "pi_1" }))
          )
        );

      await service.cambiarEstado("trayecto-1", "titular-1", "taxista", { estado: "completado" });

      expect(stripeServiceMock.capturarPagoYTransferir).toHaveBeenCalledWith("trayecto-1");
    });

    it("no revierte el estado del trayecto si falla la captura de Stripe al completar", async () => {
      supabaseServiceMock.admin.from
        .mockReturnValueOnce(
          createQueryBuilder(ok(trayectoRaw({ estado: "en_curso", taxista_titular_id: "titular-1" })))
        )
        .mockReturnValueOnce(
          createQueryBuilder(
            ok(trayectoRaw({ estado: "completado", stripe_payment_intent_id: "pi_1" }))
          )
        );
      stripeServiceMock.capturarPagoYTransferir.mockRejectedValueOnce(new Error("Stripe caído"));
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      const resultado = await service.cambiarEstado("trayecto-1", "titular-1", "taxista", {
        estado: "completado",
      });

      expect(resultado.estado).toBe("completado");
    });
  });
});
