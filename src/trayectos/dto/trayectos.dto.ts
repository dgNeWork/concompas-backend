import { z } from "zod";

// ----------------------------------------------------------------------------
// SCHEMAS DE VALIDACIÓN (Zod)
// Los schemas actúan como contrato entre el cliente y la API: si los datos
// no cumplen el formato, la petición se rechaza antes de tocar el servicio.
// ----------------------------------------------------------------------------

export const crearTrayectoSchema = z.object({
  origen_texto: z.string().min(3, "El origen debe tener al menos 3 caracteres"),
  origen_lat: z.number().min(-90).max(90),
  origen_lng: z.number().min(-180).max(180),
  destino_texto: z.string().min(3, "El destino debe tener al menos 3 caracteres"),
  destino_lat: z.number().min(-90).max(90),
  destino_lng: z.number().min(-180).max(180),
  fecha_hora_recogida: z.iso.datetime({ message: "Debe ser una fecha en formato ISO 8601" }),
  tipo_reserva: z.enum(["ida", "ida_vuelta"]),
  tipo_punto_origen: z.enum(["normal", "aeropuerto", "muelle"]).default("normal"),
  tipo_punto_destino: z.enum(["normal", "aeropuerto", "muelle"]).default("normal"),
  // SEGURIDAD: Estos tres campos son temporales mientras se negocian las tarifas
  // con los taxistas. Cuando estén definidas, el backend los calculará solo a partir
  // de una tabla de tarifas (configuracion_tarifas) y NO se aceptarán del frontend.
  // Por ahora solo el admin puede crear trayectos con precio, lo que mitiga el riesgo.
  precio_cliente: z.number().positive("El precio debe ser mayor que 0"),
  comision_plataforma: z.number().min(0),
  importe_taxista: z.number().min(0),
  notas_cliente: z.string().max(500).optional(),
});

export type CrearTrayectoInput = z.infer<typeof crearTrayectoSchema>;

export const aceptarTrayectoSchema = z.object({
  vehiculo_id: z.string().uuid("El ID de vehículo no es válido").optional(),
});

export type AceptarTrayectoInput = z.infer<typeof aceptarTrayectoSchema>;

export const cambiarEstadoSchema = z.object({
  estado: z.enum(["en_curso", "completado", "cancelado"]),
  motivo_cancelacion: z.string().min(5).optional(),
});

export type CambiarEstadoInput = z.infer<typeof cambiarEstadoSchema>;
