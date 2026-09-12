import { z } from "zod";

// Schema reutilizable para coordenadas geográficas
export const coordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Schema para calcular distancia y duración entre dos puntos
export const trayectoSchema = z.object({
  origen: coordsSchema,
  destino: coordsSchema,
});

export type TrayectoDto = z.infer<typeof trayectoSchema>;

// Schema para calcular hora de llegada dado origen, destino y hora de salida
export const horaLlegadaSchema = z.object({
  origen: coordsSchema,
  destino: coordsSchema,
  hora_salida: z.iso.datetime({ message: "hora_salida debe ser una fecha en formato ISO 8601" }),
});

export type HoraLlegadaDto = z.infer<typeof horaLlegadaSchema>;

// Schema para calcular hora de salida dado origen, destino y hora de llegada deseada.
// El origen puede ser coordenadas o texto (nombre de municipio del taxista).
export const horaSalidaSchema = z.object({
  origen: z.union([
    coordsSchema,
    z.string().min(1, "El municipio de origen no puede estar vacío"),
  ]),
  destino: coordsSchema,
  hora_llegada: z.iso.datetime({ message: "hora_llegada debe ser una fecha en formato ISO 8601" }),
});

export type HoraSalidaDto = z.infer<typeof horaSalidaSchema>;
