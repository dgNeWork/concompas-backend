// =============================================================================
// TRAYECTOS SERVICE
// =============================================================================
// Toda la lógica de negocio del módulo de trayectos vive aquí.
// El controlador solo valida datos y llama a este servicio; no conoce los
// detalles de Supabase ni de Google Maps. Principio SRP + DIP.
//
// Responsabilidades de este servicio:
//   1. Crear una reserva y calcular su duración estimada con Google Maps
//   2. Listar trayectos según el rol del usuario (cliente ve los suyos,
//      taxista ve los disponibles en su municipio)
//   3. Aplicar el matching de taxistas: regla de municipio de licencia,
//      excepción aeropuertos/muelles y excepción eventos especiales
//   4. Gestionar la aceptación de una reserva (titular → suplente)
//   5. Cambiar el estado de un trayecto con las validaciones de negocio
// =============================================================================

import { supabaseAdmin } from "../config/supabase";
import { mapsService } from "../maps/maps.service";
import { stripeService } from "../stripe/stripe.service";
import { cancelacionesService } from "../cancelaciones/cancelaciones.service";
import {
  CrearTrayectoDto,
  AceptarTrayectoDto,
  CambiarEstadoDto,
  TrayectoRespuesta,
  EstadoTrayecto,
} from "./trayectos.types";
import { RolUsuario } from "../auth/auth.types";


export class TrayectosService {

  // ---------------------------------------------------------------------------
  // CREAR TRAYECTO
  // Solo los clientes pueden crear trayectos. El backend:
  //   1. Calcula la duración estimada con Google Maps
  //   2. Guarda el trayecto con recargo = 0 (se negociará con los taxistas)
  //   3. Devuelve el trayecto creado
  // ---------------------------------------------------------------------------
  async crearTrayecto(
    clienteId: string,
    datos: CrearTrayectoDto
  ): Promise<TrayectoRespuesta> {

    // Calculamos la duración estimada del trayecto con Google Maps.
    // Si la API falla, lo guardamos sin duración (campo nullable) y continuamos.
    // El frontend mostrará el aviso de "tiempo estimado no disponible".
    let duracionMin: number | null = null;
    try {
      const resultado = await mapsService.calcularTrayecto(
        { lat: datos.origen_lat, lng: datos.origen_lng },
        { lat: datos.destino_lat, lng: datos.destino_lng }
      );
      duracionMin = Math.round(resultado.duracion_segundos / 60);
    } catch {
      // No bloqueamos la creación si Google Maps falla; la duración es informativa
    }

    // Construimos el objeto para insertar en Supabase.
    // Las coordenadas se guardan con la función ST_MakePoint de PostGIS:
    // GEOMETRY(POINT, 4326) requiere el formato WKT 'POINT(lng lat)' (longitud primero).
    const { data, error } = await supabaseAdmin
      .from("trayectos")
      .insert({
        cliente_id: clienteId,
        estado: "pendiente",
        origen_texto: datos.origen_texto,
        // PostGIS acepta WKT como string en Supabase JS client
        origen_coords: `POINT(${datos.origen_lng} ${datos.origen_lat})`,
        destino_texto: datos.destino_texto,
        destino_coords: `POINT(${datos.destino_lng} ${datos.destino_lat})`,
        fecha_hora_recogida: datos.fecha_hora_recogida,
        duracion_estimada_min: duracionMin,
        tipo_reserva: datos.tipo_reserva,
        tipo_punto_origen: datos.tipo_punto_origen,
        tipo_punto_destino: datos.tipo_punto_destino,
        precio_cliente: datos.precio_cliente,
        comision_plataforma: datos.comision_plataforma,
        importe_taxista: datos.importe_taxista,
        recargo_antelacion_porcentaje: 0, // Se negociará con los taxistas (Ticket 5.2)
        notas_cliente: datos.notas_cliente ?? null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error al crear el trayecto: ${error.message}`);
    }

    return this.mapearTrayecto(data);
  }


  // ---------------------------------------------------------------------------
  // LISTAR TRAYECTOS
  // El resultado depende del rol:
  //   - cliente: ve solo sus propios trayectos
  //   - taxista: ve los trayectos en estado 'pendiente' que puede aceptar
  //              según su municipio de licencia (con las excepciones de negocio)
  //   - admin:   ve todos los trayectos
  // ---------------------------------------------------------------------------
  async listarTrayectos(
    usuarioId: string,
    rol: RolUsuario
  ): Promise<TrayectoRespuesta[]> {

    if (rol === "cliente") {
      return this.listarTrayectosCliente(usuarioId);
    }

    if (rol === "taxista") {
      return this.listarTrayectosDisponiblesParaTaxista(usuarioId);
    }

    // Admin: devuelve todos sin filtro
    const { data, error } = await supabaseAdmin
      .from("trayectos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Error al listar trayectos: ${error.message}`);
    return (data ?? []).map(this.mapearTrayecto);
  }


  // ---------------------------------------------------------------------------
  // OBTENER TRAYECTO POR ID
  // Comprueba que el usuario tiene permiso para ver ese trayecto concreto.
  // ---------------------------------------------------------------------------
  async obtenerTrayecto(
    trayectoId: string,
    usuarioId: string,
    rol: RolUsuario
  ): Promise<TrayectoRespuesta> {

    const { data, error } = await supabaseAdmin
      .from("trayectos")
      .select("*")
      .eq("id", trayectoId)
      .single();

    if (error || !data) {
      throw new Error("Trayecto no encontrado");
    }

    // El admin puede ver cualquier trayecto.
    // El cliente solo puede ver los suyos.
    // El taxista puede ver los que tiene asignados o los pendientes de su municipio.
    const esPropietario =
      data.cliente_id === usuarioId ||
      data.taxista_titular_id === usuarioId ||
      data.taxista_reserva_id === usuarioId;

    if (rol !== "admin" && !esPropietario) {
      throw new Error("No tienes permiso para ver este trayecto");
    }

    return this.mapearTrayecto(data);
  }


  // ---------------------------------------------------------------------------
  // ACEPTAR TRAYECTO (solo taxistas)
  // El primer taxista en aceptar se convierte en titular.
  // El segundo se convierte en suplente.
  // Si ya hay titular y suplente, la reserva está completa.
  //
  // Cuando el taxista acepta, calculamos hora_salida_estimada_taxista con Google Maps:
  // el backend determina a qué hora debe salir el taxista desde su municipio para
  // llegar a tiempo al punto de recogida. Es crítico para el sistema de cancelaciones.
  // ---------------------------------------------------------------------------
  async aceptarTrayecto(
    trayectoId: string,
    taxistaId: string,
    datos: AceptarTrayectoDto
  ): Promise<TrayectoRespuesta> {

    // Leemos el trayecto y el perfil del taxista en paralelo
    const [{ data: trayecto, error: errTrayecto }, { data: perfilTaxista, error: errPerfil }] =
      await Promise.all([
        supabaseAdmin.from("trayectos").select("*").eq("id", trayectoId).single(),
        supabaseAdmin.from("taxistas_perfil").select("municipio_licencia").eq("profile_id", taxistaId).single(),
      ]);

    if (errTrayecto || !trayecto) throw new Error("Trayecto no encontrado");
    if (errPerfil || !perfilTaxista) throw new Error("Perfil de taxista no encontrado");

    // Un taxista con penalizaciones pendientes desde hace demasiado tiempo no
    // puede aceptar nuevas reservas hasta regularizar su situación (Ticket 5.2).
    await cancelacionesService.verificarSuspension(taxistaId);

    // Solo se pueden aceptar trayectos en estado pendiente o asignado (para el suplente)
    if (trayecto.estado !== "pendiente" && trayecto.estado !== "asignado") {
      throw new Error("Este trayecto ya no admite más taxistas");
    }

    // El taxista no puede aceptar una reserva que ya tiene asignada
    if (trayecto.taxista_titular_id === taxistaId || trayecto.taxista_reserva_id === taxistaId) {
      throw new Error("Ya estás asignado a este trayecto");
    }

    // Comprobamos que el taxista puede operar en este trayecto según su municipio
    await this.verificarElegibilidadTaxista(trayecto, perfilTaxista.municipio_licencia);

    // Determinamos si entra como titular o como suplente
    const esTitular = trayecto.taxista_titular_id === null;
    const esSuplente = !esTitular && trayecto.taxista_reserva_id === null;

    if (!esTitular && !esSuplente) {
      throw new Error("Este trayecto ya tiene titular y suplente asignados");
    }

    // Calculamos hora_salida_estimada_taxista solo cuando entra el titular,
    // ya que es su responsabilidad llegar a tiempo y determina las penalizaciones.
    let horaSalidaTaxista: string | null = trayecto.hora_salida_estimada_taxista ?? null;
    if (esTitular && perfilTaxista.municipio_licencia) {
      try {
        const horaSalida = await mapsService.calcularHoraSalida(
          `${perfilTaxista.municipio_licencia}, Cádiz, España`,
          { lat: trayecto.origen_lat ?? 0, lng: trayecto.origen_lng ?? 0 },
          new Date(trayecto.fecha_hora_recogida)
        );
        horaSalidaTaxista = horaSalida.toISOString();
      } catch {
        // Si Google Maps falla, continuamos sin la hora estimada.
        // El sistema de cancelaciones la tratará como no disponible.
      }
    }

    // Construimos el update según el rol que ocupa el taxista
    const camposUpdate = esTitular
      ? {
          taxista_titular_id: taxistaId,
          vehiculo_id: datos.vehiculo_id ?? null,
          estado: "asignado" as EstadoTrayecto,
          hora_salida_estimada_taxista: horaSalidaTaxista,
        }
      : {
          taxista_reserva_id: taxistaId,
          // El estado permanece 'asignado'; ya lo estaba desde que entró el titular
        };

    const { data: actualizado, error: errUpdate } = await supabaseAdmin
      .from("trayectos")
      .update(camposUpdate)
      .eq("id", trayectoId)
      .select()
      .single();

    if (errUpdate || !actualizado) {
      throw new Error("Error al aceptar el trayecto");
    }

    return this.mapearTrayecto(actualizado);
  }


  // ---------------------------------------------------------------------------
  // CAMBIAR ESTADO
  // Transiciones permitidas según rol:
  //   - Taxista titular: asignado → confirmado → en_curso → completado
  //                      cualquier estado anterior a en_curso → cancelado
  //   - Cliente:         pendiente / asignado / confirmado → cancelado
  //   - Admin:           cualquier transición (panel de control)
  //
  // Si el titular cancela: el suplente pasa a ser titular y se lanza
  // una notificación para buscar nuevo suplente (TODO: Expo Push, Ticket futuro).
  // ---------------------------------------------------------------------------
  async cambiarEstado(
    trayectoId: string,
    usuarioId: string,
    rol: RolUsuario,
    datos: CambiarEstadoDto
  ): Promise<TrayectoRespuesta> {

    const { data: trayecto, error } = await supabaseAdmin
      .from("trayectos")
      .select("*")
      .eq("id", trayectoId)
      .single();

    if (error || !trayecto) throw new Error("Trayecto no encontrado");

    // Validamos que el usuario tiene permiso para cambiar el estado de este trayecto
    this.verificarPermisoEstado(trayecto, usuarioId, rol, datos.estado);

    // Si se cancela, el motivo es obligatorio
    if (datos.estado === "cancelado" && !datos.motivo_cancelacion) {
      throw new Error("El motivo de cancelación es obligatorio");
    }

    // Cancelación del cliente: aplica la tabla de tramos por antelación
    // (cobro al cliente vía Stripe + compensación a titular/suplente).
    // Si cancela el admin, no se cobra ni se penaliza a nadie (es la vía de
    // "regularizar a mano" casos de fuerza mayor).
    if (datos.estado === "cancelado" && rol === "cliente") {
      await cancelacionesService.procesarCancelacionCliente(trayecto);
    }

    // Si el taxista titular cancela, el suplente pasa a ser el nuevo titular y
    // se genera la penalización correspondiente al taxista que cancela.
    let camposExtra: Record<string, unknown> = {};
    if (datos.estado === "cancelado" && trayecto.taxista_titular_id === usuarioId) {
      camposExtra = {
        taxista_titular_id: trayecto.taxista_reserva_id ?? null,
        taxista_reserva_id: null,
        // Si no había suplente, el trayecto vuelve a pendiente para buscar taxi
        estado: trayecto.taxista_reserva_id ? "asignado" : "pendiente",
      };
      await cancelacionesService.procesarCancelacionTaxista(trayecto, usuarioId);
      // TODO Ticket notificaciones: avisar para buscar nuevo suplente
    }

    const { data: actualizado, error: errUpdate } = await supabaseAdmin
      .from("trayectos")
      .update({
        estado: camposExtra.estado ?? datos.estado,
        motivo_cancelacion: datos.motivo_cancelacion ?? null,
        finalizado_at: datos.estado === "completado" ? new Date().toISOString() : null,
        ...camposExtra,
      })
      .eq("id", trayectoId)
      .select()
      .single();

    if (errUpdate || !actualizado) {
      throw new Error("Error al cambiar el estado del trayecto");
    }

    // Cuando el trayecto se completa, capturamos el pago y transferimos al taxista.
    // Lo hacemos después de actualizar la BD para que el trayecto ya esté en 'completado'
    // antes de llamar a Stripe. Si Stripe falla, el trayecto queda completado igualmente
    // y el admin puede procesar el pago manualmente desde el panel.
    if (datos.estado === "completado" && actualizado.stripe_payment_intent_id) {
      try {
        await stripeService.capturarPagoYTransferir(trayectoId);
      } catch (error) {
        // No revertimos el estado del trayecto por un fallo de Stripe.
        // El servicio se prestó correctamente; el pago se recupera manualmente.
        // TODO Ticket 5.2: notificar al admin cuando la captura falla
        const mensaje = error instanceof Error ? error.message : "Error desconocido";
        console.error(`Error al capturar el pago del trayecto ${trayectoId}: ${mensaje}`);
      }
    }

    return this.mapearTrayecto(actualizado);
  }


  // ===========================================================================
  // MÉTODOS PRIVADOS — lógica interna no expuesta fuera del servicio
  // ===========================================================================

  // Devuelve los trayectos de un cliente concreto, ordenados por fecha de recogida.
  private async listarTrayectosCliente(clienteId: string): Promise<TrayectoRespuesta[]> {
    const { data, error } = await supabaseAdmin
      .from("trayectos")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("fecha_hora_recogida", { ascending: true });

    if (error) throw new Error(`Error al listar trayectos: ${error.message}`);
    return (data ?? []).map(this.mapearTrayecto);
  }

  // Devuelve los trayectos en estado 'pendiente' o 'asignado' (para el suplente)
  // que el taxista puede aceptar según su municipio de licencia y las excepciones de negocio.
  //
  // REGLA GENERAL: el taxista solo ve trayectos cuyo origen está en su municipio.
  // EXCEPCIÓN AEROPUERTO/MUELLE: si el origen es aeropuerto o muelle, se usa el destino.
  // EXCEPCIÓN EVENTOS ESPECIALES: si la fecha cae en un evento activo, cualquier taxi
  //   de la provincia puede ver la reserva.
  private async listarTrayectosDisponiblesParaTaxista(taxistaId: string): Promise<TrayectoRespuesta[]> {

    // Obtenemos el municipio de licencia del taxista
    const { data: perfil, error: errPerfil } = await supabaseAdmin
      .from("taxistas_perfil")
      .select("municipio_licencia")
      .eq("profile_id", taxistaId)
      .single();

    if (errPerfil || !perfil?.municipio_licencia) {
      throw new Error("No se encontró el municipio de licencia del taxista");
    }

    const municipio = perfil.municipio_licencia;

    // Traemos los trayectos candidatos: pendientes o asignados (sin suplente aún)
    // y que el taxista no tiene ya asignados
    const { data: trayectos, error } = await supabaseAdmin
      .from("trayectos")
      .select("*")
      .in("estado", ["pendiente", "asignado"])
      .neq("taxista_titular_id", taxistaId)
      .neq("taxista_reserva_id", taxistaId)
      .order("fecha_hora_recogida", { ascending: true });

    if (error) throw new Error(`Error al listar trayectos: ${error.message}`);
    if (!trayectos || trayectos.length === 0) return [];

    // Obtenemos los eventos especiales activos de la provincia para el rango de fechas
    // que cubren los trayectos candidatos. Una sola consulta para no ir a BD por cada trayecto.
    const fechaMin = trayectos[0].fecha_hora_recogida;
    const fechaMax = trayectos[trayectos.length - 1].fecha_hora_recogida;

    const { data: eventos } = await supabaseAdmin
      .from("eventos_especiales_provincia")
      .select("fecha_inicio, fecha_fin")
      .eq("activo", true)
      .lte("fecha_inicio", fechaMax)   // el evento empieza antes del último trayecto
      .gte("fecha_fin", fechaMin);     // el evento termina después del primer trayecto

    const eventosActivos = eventos ?? [];

    // Filtramos en memoria aplicando las tres reglas de negocio
    const trayectosFiltrados = trayectos.filter((t) => {
      // Excepción eventos especiales: si la fecha del trayecto cae dentro de un evento
      // activo, cualquier taxista de la provincia puede verlo (sin restricción de municipio)
      const fechaRecogida = t.fecha_hora_recogida.substring(0, 10); // 'YYYY-MM-DD'
      const enEventoEspecial = eventosActivos.some(
        (e) => fechaRecogida >= e.fecha_inicio && fechaRecogida <= e.fecha_fin
      );
      if (enEventoEspecial) return true;

      // Excepción aeropuerto/muelle: si el origen es aeropuerto o muelle,
      // la regla de municipio se aplica al DESTINO, no al origen.
      // Ej: Aeropuerto de Sevilla → Jerez = solo taxis de Jerez (municipio de destino)
      const usaDestino =
        t.tipo_punto_origen === "aeropuerto" || t.tipo_punto_origen === "muelle";

      const textoReferencia = usaDestino ? t.destino_texto : t.origen_texto;

      // Comprobamos si el municipio del taxista aparece en el texto del punto de referencia.
      // Es una comparación flexible que funciona aunque el texto incluya la dirección completa.
      // Ej: municipio="Jerez de la Frontera", texto="Calle Larga 10, Jerez de la Frontera" → match
      return textoReferencia.toLowerCase().includes(municipio.toLowerCase());
    });

    return trayectosFiltrados.map(this.mapearTrayecto);
  }

  // Verifica que el taxista puede aceptar el trayecto dado según las reglas de negocio.
  // Lanza un error descriptivo si no puede, para que el controlador devuelva 403.
  private async verificarElegibilidadTaxista(
    trayecto: Record<string, unknown>,
    municipioLicencia: string
  ): Promise<void> {

    if (!municipioLicencia) {
      throw new Error("El taxista no tiene municipio de licencia registrado");
    }

    // Comprobamos primero la excepción de eventos especiales
    const fechaRecogida = (trayecto.fecha_hora_recogida as string).substring(0, 10);
    const { data: eventos } = await supabaseAdmin
      .from("eventos_especiales_provincia")
      .select("id")
      .eq("activo", true)
      .lte("fecha_inicio", fechaRecogida)
      .gte("fecha_fin", fechaRecogida)
      .limit(1);

    // Si hay un evento activo ese día, cualquier taxi de la provincia puede operar
    if (eventos && eventos.length > 0) return;

    // Aplicamos la regla de municipio normal / aeropuerto / muelle
    const usaDestino =
      trayecto.tipo_punto_origen === "aeropuerto" ||
      trayecto.tipo_punto_origen === "muelle";

    const textoReferencia = usaDestino
      ? (trayecto.destino_texto as string)
      : (trayecto.origen_texto as string);

    if (!textoReferencia.toLowerCase().includes(municipioLicencia.toLowerCase())) {
      throw new Error(
        `Tu municipio de licencia (${municipioLicencia}) no coincide con el municipio requerido para este trayecto`
      );
    }
  }

  // Valida que el usuario tiene permiso para realizar la transición de estado solicitada.
  // Lanza un error si la transición no es válida para su rol o el estado actual no lo permite.
  private verificarPermisoEstado(
    trayecto: Record<string, unknown>,
    usuarioId: string,
    rol: RolUsuario,
    nuevoEstado: EstadoTrayecto
  ): void {

    const estadoActual = trayecto.estado as EstadoTrayecto;

    if (rol === "admin") return; // El admin puede hacer cualquier transición

    if (rol === "cliente") {
      // El cliente solo puede cancelar y solo si el trayecto no ha empezado
      if (nuevoEstado !== "cancelado") {
        throw new Error("El cliente solo puede cancelar trayectos");
      }
      if (estadoActual === "en_curso" || estadoActual === "completado") {
        throw new Error("No se puede cancelar un trayecto que ya está en curso o completado");
      }
      if (trayecto.cliente_id !== usuarioId) {
        throw new Error("No tienes permiso para cancelar este trayecto");
      }
      return;
    }

    if (rol === "taxista") {
      const esTitular = trayecto.taxista_titular_id === usuarioId;
      if (!esTitular) {
        throw new Error("Solo el taxista titular puede cambiar el estado del trayecto");
      }

      // Transiciones válidas para el titular.
      // No existe estado 'confirmado': la garantía al cliente la da el sistema de penalizaciones,
      // no un estado intermedio. El taxi pasa directamente de asignado a en_curso.
      const transicionesValidas: Partial<Record<EstadoTrayecto, EstadoTrayecto[]>> = {
        asignado: ["en_curso", "cancelado"],
        en_curso: ["completado"],
      };

      const permitidas = transicionesValidas[estadoActual] ?? [];
      if (!permitidas.includes(nuevoEstado)) {
        throw new Error(
          `No se puede pasar de '${estadoActual}' a '${nuevoEstado}'`
        );
      }
    }
  }

  // Transforma el objeto crudo de Supabase al tipo TrayectoRespuesta que devuelve la API.
  // Centralizar esta transformación aquí evita repetirla en cada método del servicio.
  private mapearTrayecto(raw: Record<string, unknown>): TrayectoRespuesta {
    return {
      id: raw.id as string,
      cliente_id: raw.cliente_id as string,
      taxista_titular_id: (raw.taxista_titular_id as string) ?? null,
      taxista_reserva_id: (raw.taxista_reserva_id as string) ?? null,
      vehiculo_id: (raw.vehiculo_id as string) ?? null,
      estado: raw.estado as TrayectoRespuesta["estado"],
      origen_texto: raw.origen_texto as string,
      destino_texto: raw.destino_texto as string,
      fecha_hora_recogida: raw.fecha_hora_recogida as string,
      duracion_estimada_min: (raw.duracion_estimada_min as number) ?? null,
      tipo_reserva: raw.tipo_reserva as TrayectoRespuesta["tipo_reserva"],
      tipo_punto_origen: raw.tipo_punto_origen as TrayectoRespuesta["tipo_punto_origen"],
      tipo_punto_destino: raw.tipo_punto_destino as TrayectoRespuesta["tipo_punto_destino"],
      precio_cliente: raw.precio_cliente as number,
      comision_plataforma: raw.comision_plataforma as number,
      importe_taxista: raw.importe_taxista as number,
      recargo_antelacion_porcentaje: raw.recargo_antelacion_porcentaje as number,
      hora_salida_estimada_taxista: (raw.hora_salida_estimada_taxista as string) ?? null,
      notas_cliente: (raw.notas_cliente as string) ?? null,
      motivo_cancelacion: (raw.motivo_cancelacion as string) ?? null,
      created_at: raw.created_at as string,
      updated_at: raw.updated_at as string,
    };
  }
}

export const trayectosService = new TrayectosService();
