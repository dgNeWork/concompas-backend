// =============================================================================
// TIPOS Y DTOs DEL MÓDULO DE TRAYECTOS
// =============================================================================
// Definimos aquí todos los tipos que usa el módulo de trayectos.
// Separarlos del servicio y del controlador permite importarlos desde cualquier
// parte del proyecto sin crear dependencias circulares.
//
// Principio SRP: este archivo solo declara formas de datos, sin lógica.
// =============================================================================


// ----------------------------------------------------------------------------
// ENUMS — reflejan los tipos ENUM definidos en la base de datos (migración 006)
// ----------------------------------------------------------------------------

// Tipo de reserva: ida simple o ida con vuelta.
// En ida_vuelta, el tiempo de espera se paga directamente al taxista (no pasa por la app).
export type TipoReserva = "ida" | "ida_vuelta";

// Tipo de punto geográfico: determina qué regla de licencia municipal se aplica.
// - aeropuerto / muelle: se usa el municipio de DESTINO para el matching de taxistas
// - normal: se usa el municipio de ORIGEN (regla general)
export type TipoPunto = "normal" | "aeropuerto" | "muelle";

// Ciclo de vida de un trayecto (refleja el ENUM estado_trayecto de la BD)
export type EstadoTrayecto =
  | "pendiente"    // Creado, sin taxista asignado
  | "asignado"     // Taxi titular asignado; a partir de aquí corren los relojes de penalización
  | "en_curso"     // El taxista recogió al cliente; ya no se puede cancelar
  | "completado"   // Servicio finalizado correctamente; se activa el pago al taxista
  | "cancelado";   // Cancelado por cliente o taxista, con penalización según tiempo restante


// ----------------------------------------------------------------------------
// DTOs de entrada — viven junto a sus schemas de Zod en ./dto/trayectos.dto.ts
// (CrearTrayectoInput, AceptarTrayectoInput, CambiarEstadoInput).
// ----------------------------------------------------------------------------

// Forma del trayecto tal como lo devuelve la API (incluye campos calculados por el backend)
export interface TrayectoRespuesta {
  id: string;
  cliente_id: string;
  taxista_titular_id: string | null;
  taxista_reserva_id: string | null;
  vehiculo_id: string | null;
  estado: EstadoTrayecto;
  origen_texto: string;
  destino_texto: string;
  fecha_hora_recogida: string;
  duracion_estimada_min: number | null;
  tipo_reserva: TipoReserva;
  tipo_punto_origen: TipoPunto;
  tipo_punto_destino: TipoPunto;
  precio_cliente: number;
  comision_plataforma: number;
  importe_taxista: number;
  recargo_antelacion_porcentaje: number;
  hora_salida_estimada_taxista: string | null;
  notas_cliente: string | null;
  motivo_cancelacion: string | null;
  created_at: string;
  updated_at: string;
}
