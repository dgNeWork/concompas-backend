// =============================================================================
// TIPOS Y DTOs DEL MÓDULO DE CANCELACIONES
// =============================================================================
// Principio SRP: este archivo solo declara formas de datos, sin lógica.
// =============================================================================


// Ciclo de vida de una penalización al taxista (refleja el ENUM estado_penalizacion
// de la BD, migración 006).
export type EstadoPenalizacion = "pendiente" | "descontada" | "cancelada_con_justificacion";


// Tramo de configuración tal como se lee de configuracion_penalizaciones_cancelacion
// (migración 008). Cada tramo trae los 4 conceptos x 2 tipos de trayecto (ciudad /
// fuera de ciudad): qué columnas usar depende de si el trayecto supera el umbral
// de duración configurado en UMBRAL_FUERA_CIUDAD_MINUTOS.
export interface TramoPenalizacionCancelacion {
  horas_desde: number;
  horas_hasta: number | null;
  porcentaje_cobro_cliente_ciudad: number;
  porcentaje_cobro_cliente_fuera_ciudad: number;
  porcentaje_compensacion_titular_ciudad: number;
  porcentaje_compensacion_titular_fuera_ciudad: number;
  porcentaje_penalizacion_taxista_ciudad: number;
  porcentaje_penalizacion_taxista_fuera_ciudad: number;
  porcentaje_incentivo_suplente_ciudad: number;
  porcentaje_incentivo_suplente_fuera_ciudad: number;
}


// Resultado del cálculo de cancelación del CLIENTE: qué se cobró/compensó a cada parte.
// Útil para que trayectos.service.ts pueda loguear o devolver información al frontend.
export interface ResultadoCancelacionCliente {
  horasAntesServicio: number;
  esFueraCiudad: boolean;
  taxistaYaSalio: boolean;
  porcentajeCobroCliente: number;
  porcentajeCompensacionTitular: number;
  porcentajeIncentivoSuplente: number;
}


// Resultado del cálculo de cancelación del TAXISTA (titular o suplente) que cancela
// una reserva ya aceptada.
export interface ResultadoCancelacionTaxista {
  horasAntesServicio: number;
  esFueraCiudad: boolean;
  porcentajePenalizacion: number;
  importePenalizacion: number;
}


// DTO para que el taxista añada una justificación a su propia penalización.
export interface JustificarPenalizacionDto {
  justificacion: string;
}


// DTO para que el admin resuelva una penalización pendiente.
export interface ResolverPenalizacionDto {
  estado: "descontada" | "cancelada_con_justificacion";
}


// Forma de la penalización tal como la devuelve la API.
export interface PenalizacionRespuesta {
  id: string;
  taxista_id: string;
  trayecto_id: string;
  importe: number;
  horas_antes_servicio: number;
  estado: EstadoPenalizacion;
  justificacion: string | null;
  created_at: string;
  updated_at: string;
}
