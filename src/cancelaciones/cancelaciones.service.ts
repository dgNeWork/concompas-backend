// =============================================================================
// CANCELACIONES SERVICE
// =============================================================================
// Toda la lógica de negocio del sistema de cancelaciones y penalizaciones vive
// aquí. trayectos.service.ts llama a este servicio desde cambiarEstado() y
// aceptarTrayecto(); no expone un endpoint propio de "cancelar", el cliente y
// el taxista siguen usando PATCH /trayectos/:id/estado como ya hacían.
//
// Responsabilidades de este servicio:
//   1. Calcular qué tramo de penalización aplica (horas de antelación + si el
//      trayecto es "fuera de ciudad") y aplicar el override "taxista ya salió"
//   2. Ejecutar el cobro/liberación al cliente vía Stripe cuando cancela él
//   3. Generar la penalización al taxista cuando cancela él
//   4. Gestionar justificaciones del taxista y su resolución por el admin
//   5. Comprobar si un taxista está suspendido por impago prolongado
// =============================================================================

import { supabaseAdmin } from "../config/supabase";
import { stripeService } from "../stripe/stripe.service";
import {
  TramoPenalizacionCancelacion,
  ResultadoCancelacionCliente,
  ResultadoCancelacionTaxista,
  JustificarPenalizacionDto,
  ResolverPenalizacionDto,
  PenalizacionRespuesta,
  EstadoPenalizacion,
} from "./cancelaciones.types";


export class CancelacionesService {

  // ---------------------------------------------------------------------------
  // PROCESAR CANCELACIÓN DEL CLIENTE
  // Calcula el tramo aplicable (horas de antelación + ciudad/fuera de ciudad),
  // aplica el override "taxista ya salió" si corresponde, cobra al cliente la
  // parte que proceda vía captura parcial de Stripe, y compensa al titular y
  // al suplente (si los hay) acumulando en su incentivo_acumulado.
  // ---------------------------------------------------------------------------
  async procesarCancelacionCliente(trayecto: Record<string, unknown>): Promise<ResultadoCancelacionCliente> {

    const horasAntesServicio = this.calcularHorasAntesServicio(trayecto.fecha_hora_recogida as string);
    const esFueraCiudad = this.esFueraCiudad(trayecto.duracion_estimada_min as number | null);
    const tramo = await this.obtenerTramoAplicable(horasAntesServicio);

    let porcentajeCobroCliente = esFueraCiudad
      ? tramo.porcentaje_cobro_cliente_fuera_ciudad
      : tramo.porcentaje_cobro_cliente_ciudad;
    let porcentajeCompensacionTitular = esFueraCiudad
      ? tramo.porcentaje_compensacion_titular_fuera_ciudad
      : tramo.porcentaje_compensacion_titular_ciudad;
    const porcentajeIncentivoSuplente = esFueraCiudad
      ? tramo.porcentaje_incentivo_suplente_fuera_ciudad
      : tramo.porcentaje_incentivo_suplente_ciudad;

    // Override "taxista ya salió": regla de negocio fija, no pendiente de negociar.
    // Solo se puede determinar si tenemos hora_salida_estimada_taxista; si Google
    // Maps falló al aceptar y el campo es NULL, no se puede saber y se aplica el
    // tramo normal sin override.
    const horaSalidaTaxista = trayecto.hora_salida_estimada_taxista as string | null;
    const taxistaYaSalio = !!horaSalidaTaxista && Date.now() >= new Date(horaSalidaTaxista).getTime();

    if (taxistaYaSalio) {
      porcentajeCobroCliente = 100;
      porcentajeCompensacionTitular = 100;
    }

    const trayectoId = trayecto.id as string;
    const taxistaTitularId = trayecto.taxista_titular_id as string | null;

    // Si no hay taxista titular asignado, nadie se vio perjudicado: cobro 0 al
    // cliente y nada que compensar, sea cual sea el tramo encontrado.
    if (!taxistaTitularId) {
      await stripeService.capturarParcialOCancelar(trayectoId, 0);
      return {
        horasAntesServicio,
        esFueraCiudad,
        taxistaYaSalio,
        porcentajeCobroCliente: 0,
        porcentajeCompensacionTitular: 0,
        porcentajeIncentivoSuplente: 0,
      };
    }

    await stripeService.capturarParcialOCancelar(trayectoId, porcentajeCobroCliente);

    const importeTaxista = trayecto.importe_taxista as number;

    if (porcentajeCompensacionTitular > 0) {
      const compensacion = this.calcularImporte(importeTaxista, porcentajeCompensacionTitular);
      await this.incrementarIncentivoAcumulado(taxistaTitularId, compensacion);
    }

    const taxistaSuplenteId = trayecto.taxista_reserva_id as string | null;
    if (taxistaSuplenteId && porcentajeIncentivoSuplente > 0) {
      const incentivo = this.calcularImporte(importeTaxista, porcentajeIncentivoSuplente);
      await this.incrementarIncentivoAcumulado(taxistaSuplenteId, incentivo);
    }

    return {
      horasAntesServicio,
      esFueraCiudad,
      taxistaYaSalio,
      porcentajeCobroCliente,
      porcentajeCompensacionTitular,
      porcentajeIncentivoSuplente,
    };
  }


  // ---------------------------------------------------------------------------
  // PROCESAR CANCELACIÓN DEL TAXISTA
  // El taxista (titular o suplente) cancela una reserva ya aceptada. Genera la
  // penalización correspondiente al tramo y la registra en penalizaciones_taxista,
  // incrementando penalizacion_pendiente del taxista que cancela.
  // ---------------------------------------------------------------------------
  async procesarCancelacionTaxista(
    trayecto: Record<string, unknown>,
    taxistaQueCancelaId: string
  ): Promise<ResultadoCancelacionTaxista> {

    const horasAntesServicio = this.calcularHorasAntesServicio(trayecto.fecha_hora_recogida as string);
    const esFueraCiudad = this.esFueraCiudad(trayecto.duracion_estimada_min as number | null);
    const tramo = await this.obtenerTramoAplicable(horasAntesServicio);

    const porcentajePenalizacion = esFueraCiudad
      ? tramo.porcentaje_penalizacion_taxista_fuera_ciudad
      : tramo.porcentaje_penalizacion_taxista_ciudad;

    const importeTaxista = trayecto.importe_taxista as number;
    const importePenalizacion = this.calcularImporte(importeTaxista, porcentajePenalizacion);

    if (importePenalizacion > 0) {
      const { error } = await supabaseAdmin.from("penalizaciones_taxista").insert({
        taxista_id: taxistaQueCancelaId,
        trayecto_id: trayecto.id as string,
        importe: importePenalizacion,
        horas_antes_servicio: horasAntesServicio,
        estado: "pendiente",
      });

      if (error) throw new Error(`Error al registrar la penalización: ${error.message}`);

      await this.actualizarPenalizacionPendiente(taxistaQueCancelaId, importePenalizacion);
    }

    return { horasAntesServicio, esFueraCiudad, porcentajePenalizacion, importePenalizacion };
  }


  // ---------------------------------------------------------------------------
  // JUSTIFICAR PENALIZACIÓN
  // El taxista penalizado añade un texto explicativo para que el admin lo revise.
  // Solo se puede justificar mientras la penalización está en estado 'pendiente'.
  // ---------------------------------------------------------------------------
  async justificarPenalizacion(
    penalizacionId: string,
    taxistaId: string,
    datos: JustificarPenalizacionDto
  ): Promise<PenalizacionRespuesta> {

    const { data: penalizacion, error } = await supabaseAdmin
      .from("penalizaciones_taxista")
      .select("*")
      .eq("id", penalizacionId)
      .single();

    if (error || !penalizacion) throw new Error("Penalización no encontrada");
    if (penalizacion.taxista_id !== taxistaId) {
      throw new Error("No tienes permiso para justificar esta penalización");
    }
    if (penalizacion.estado !== "pendiente") {
      throw new Error("Solo se puede justificar una penalización en estado pendiente");
    }

    const { data: actualizada, error: errUpdate } = await supabaseAdmin
      .from("penalizaciones_taxista")
      .update({ justificacion: datos.justificacion })
      .eq("id", penalizacionId)
      .select()
      .single();

    if (errUpdate || !actualizada) throw new Error("Error al guardar la justificación");

    return this.mapearPenalizacion(actualizada);
  }


  // ---------------------------------------------------------------------------
  // RESOLVER PENALIZACIÓN (admin)
  // 'descontada': la deja resuelta tal cual; el descuento real ya se gestiona en
  // el flujo de retiro/pago existente (retirarIncentivo neta penalizacion_pendiente).
  // 'cancelada_con_justificacion': anula la penalización y decrementa
  // penalizacion_pendiente del taxista por el importe exacto.
  // ---------------------------------------------------------------------------
  async resolverPenalizacion(
    penalizacionId: string,
    datos: ResolverPenalizacionDto
  ): Promise<PenalizacionRespuesta> {

    const { data: penalizacion, error } = await supabaseAdmin
      .from("penalizaciones_taxista")
      .select("*")
      .eq("id", penalizacionId)
      .single();

    if (error || !penalizacion) throw new Error("Penalización no encontrada");
    if (penalizacion.estado !== "pendiente") {
      throw new Error("Esta penalización ya fue resuelta");
    }

    const { data: actualizada, error: errUpdate } = await supabaseAdmin
      .from("penalizaciones_taxista")
      .update({ estado: datos.estado })
      .eq("id", penalizacionId)
      .select()
      .single();

    if (errUpdate || !actualizada) throw new Error("Error al resolver la penalización");

    if (datos.estado === "cancelada_con_justificacion") {
      await this.actualizarPenalizacionPendiente(penalizacion.taxista_id, -Number(penalizacion.importe));
    }

    return this.mapearPenalizacion(actualizada);
  }


  // ---------------------------------------------------------------------------
  // LISTAR PENALIZACIONES DEL TAXISTA AUTENTICADO
  // Conveniencia para que el taxista descubra el penalizacionId que necesita
  // antes de justificar — la API no expone Supabase directo al cliente.
  // ---------------------------------------------------------------------------
  async listarPenalizacionesTaxista(taxistaId: string): Promise<PenalizacionRespuesta[]> {
    const { data, error } = await supabaseAdmin
      .from("penalizaciones_taxista")
      .select("*")
      .eq("taxista_id", taxistaId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Error al listar penalizaciones: ${error.message}`);
    return (data ?? []).map(this.mapearPenalizacion);
  }


  // ---------------------------------------------------------------------------
  // VERIFICAR SUSPENSIÓN
  // Usado por trayectos.service.ts (aceptarTrayecto) para bloquear taxistas con
  // saldo negativo prolongado. Lanza un error descriptivo si está suspendido.
  // ---------------------------------------------------------------------------
  async verificarSuspension(taxistaId: string): Promise<void> {
    const { data: perfil, error } = await supabaseAdmin
      .from("taxistas_perfil")
      .select("penalizacion_pendiente, penalizacion_pendiente_desde")
      .eq("profile_id", taxistaId)
      .single();

    if (error || !perfil) throw new Error("Perfil de taxista no encontrado");

    if (Number(perfil.penalizacion_pendiente) <= 0 || !perfil.penalizacion_pendiente_desde) return;

    const diasLimite = Number(process.env.SUSPENSION_DIAS_LIMITE ?? 7);
    const desde = new Date(perfil.penalizacion_pendiente_desde as string).getTime();
    const diasTranscurridos = (Date.now() - desde) / (1000 * 60 * 60 * 24);

    if (diasTranscurridos > diasLimite) {
      throw new Error(
        `Cuenta suspendida por impago de penalizaciones pendientes desde hace más de ${diasLimite} días`
      );
    }
  }


  // ===========================================================================
  // MÉTODOS PRIVADOS — lógica interna no expuesta fuera del servicio
  // ===========================================================================

  // Trae todos los tramos activos y elige en memoria el que corresponde a las
  // horas dadas. Más simple y robusto que expresar "horas_hasta IS NULL OR
  // horas < horas_hasta" en una sola query de supabase-js, y la tabla es pequeña.
  private async obtenerTramoAplicable(horasAntesServicio: number): Promise<TramoPenalizacionCancelacion> {
    const { data, error } = await supabaseAdmin
      .from("configuracion_penalizaciones_cancelacion")
      .select("*")
      .eq("activo", true);

    if (error || !data || data.length === 0) {
      throw new Error("No hay tramos de penalización por cancelación configurados");
    }

    const tramo = data.find((t) => {
      const horasDesde = Number(t.horas_desde);
      const horasHasta = t.horas_hasta === null ? null : Number(t.horas_hasta);
      return horasAntesServicio >= horasDesde && (horasHasta === null || horasAntesServicio < horasHasta);
    });

    if (!tramo) {
      throw new Error(`No se encontró un tramo de penalización para ${horasAntesServicio} horas de antelación`);
    }

    return {
      horas_desde: Number(tramo.horas_desde),
      horas_hasta: tramo.horas_hasta === null ? null : Number(tramo.horas_hasta),
      porcentaje_cobro_cliente_ciudad: Number(tramo.porcentaje_cobro_cliente_ciudad),
      porcentaje_cobro_cliente_fuera_ciudad: Number(tramo.porcentaje_cobro_cliente_fuera_ciudad),
      porcentaje_compensacion_titular_ciudad: Number(tramo.porcentaje_compensacion_titular_ciudad),
      porcentaje_compensacion_titular_fuera_ciudad: Number(tramo.porcentaje_compensacion_titular_fuera_ciudad),
      porcentaje_penalizacion_taxista_ciudad: Number(tramo.porcentaje_penalizacion_taxista_ciudad),
      porcentaje_penalizacion_taxista_fuera_ciudad: Number(tramo.porcentaje_penalizacion_taxista_fuera_ciudad),
      porcentaje_incentivo_suplente_ciudad: Number(tramo.porcentaje_incentivo_suplente_ciudad),
      porcentaje_incentivo_suplente_fuera_ciudad: Number(tramo.porcentaje_incentivo_suplente_fuera_ciudad),
    };
  }

  // Horas que faltan hasta fecha_hora_recogida en el momento de cancelar. Nunca
  // negativo: si la cancelación ocurre después de la hora de recogida, se trata
  // como "0 horas de antelación" (el tramo más penalizador).
  private calcularHorasAntesServicio(fechaHoraRecogida: string): number {
    const msRestantes = new Date(fechaHoraRecogida).getTime() - Date.now();
    return Math.max(0, msRestantes / (1000 * 60 * 60));
  }

  // Clasifica el trayecto como "fuera de ciudad" si su duración estimada (ya
  // calculada por Google Maps al crear la reserva) supera el umbral configurado.
  private esFueraCiudad(duracionEstimadaMin: number | null): boolean {
    const umbral = Number(process.env.UMBRAL_FUERA_CIUDAD_MINUTOS ?? 90);
    return duracionEstimadaMin !== null && duracionEstimadaMin > umbral;
  }

  private calcularImporte(base: number, porcentaje: number): number {
    return Math.round(base * (porcentaje / 100) * 100) / 100;
  }

  // Ajusta penalizacion_pendiente del taxista por un delta (positivo al generar
  // una penalización, negativo al anularla) y gestiona penalizacion_pendiente_desde:
  // se rellena cuando el saldo pasa de 0 a positivo, se limpia cuando vuelve a 0.
  private async actualizarPenalizacionPendiente(taxistaId: string, delta: number): Promise<void> {
    const { data: perfil, error } = await supabaseAdmin
      .from("taxistas_perfil")
      .select("penalizacion_pendiente")
      .eq("profile_id", taxistaId)
      .single();

    if (error || !perfil) throw new Error("Perfil de taxista no encontrado");

    const actual = Number(perfil.penalizacion_pendiente);
    const nuevo = Math.max(0, actual + delta);

    const camposUpdate: Record<string, unknown> = { penalizacion_pendiente: nuevo };
    if (actual <= 0 && nuevo > 0) {
      camposUpdate.penalizacion_pendiente_desde = new Date().toISOString();
    } else if (nuevo <= 0) {
      camposUpdate.penalizacion_pendiente_desde = null;
    }

    await supabaseAdmin.from("taxistas_perfil").update(camposUpdate).eq("profile_id", taxistaId);
  }

  private async incrementarIncentivoAcumulado(taxistaId: string, importe: number): Promise<void> {
    const { data: perfil, error } = await supabaseAdmin
      .from("taxistas_perfil")
      .select("incentivo_acumulado")
      .eq("profile_id", taxistaId)
      .single();

    if (error || !perfil) throw new Error("Perfil de taxista no encontrado");

    const nuevo = Number(perfil.incentivo_acumulado) + importe;

    await supabaseAdmin
      .from("taxistas_perfil")
      .update({ incentivo_acumulado: nuevo })
      .eq("profile_id", taxistaId);
  }

  private mapearPenalizacion(raw: Record<string, unknown>): PenalizacionRespuesta {
    return {
      id: raw.id as string,
      taxista_id: raw.taxista_id as string,
      trayecto_id: raw.trayecto_id as string,
      importe: raw.importe as number,
      horas_antes_servicio: raw.horas_antes_servicio as number,
      estado: raw.estado as EstadoPenalizacion,
      justificacion: (raw.justificacion as string) ?? null,
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
    };
  }
}

export const cancelacionesService = new CancelacionesService();
