import { Request, Response } from "express";
import { z } from "zod";
import { mapsService } from "./maps.service";

// Schema reutilizable para coordenadas geográficas
const coordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Schema para calcular distancia y duración entre dos puntos
const trayectoSchema = z.object({
  origen: coordsSchema,
  destino: coordsSchema,
});

// Schema para calcular hora de llegada dado origen, destino y hora de salida
const horaLlegadaSchema = z.object({
  origen: coordsSchema,
  destino: coordsSchema,
  hora_salida: z.iso.datetime({ message: "hora_salida debe ser una fecha en formato ISO 8601" }),
});

// Schema para calcular hora de salida dado origen, destino y hora de llegada deseada.
// El origen puede ser coordenadas o texto (nombre de municipio del taxista).
const horaSalidaSchema = z.object({
  origen: z.union([
    coordsSchema,
    z.string().min(1, "El municipio de origen no puede estar vacío"),
  ]),
  destino: coordsSchema,
  hora_llegada: z.iso.datetime({ message: "hora_llegada debe ser una fecha en formato ISO 8601" }),
});

export class MapsController {

  // POST /maps/trayecto
  // Devuelve la distancia y duración estimada entre dos puntos.
  // Llamado desde el frontend al crear una reserva para mostrar al cliente el tiempo del viaje.
  async trayecto(req: Request, res: Response): Promise<void> {
    const resultado = trayectoSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const datos = await mapsService.calcularTrayecto(
        resultado.data.origen,
        resultado.data.destino
      );
      res.status(200).json(datos);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular el trayecto";
      res.status(500).json({ error: mensaje });
    }
  }

  // POST /maps/hora-llegada
  // Dado un origen, destino y hora de salida, devuelve cuándo se llega.
  // Útil para el cliente que introduce "salgo a las 9:00, ¿a qué hora llego?".
  async horaLlegada(req: Request, res: Response): Promise<void> {
    const resultado = horaLlegadaSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const horaLlegada = await mapsService.calcularHoraLlegada(
        resultado.data.origen,
        resultado.data.destino,
        new Date(resultado.data.hora_salida)
      );
      res.status(200).json({
        hora_llegada_estimada: horaLlegada.toISOString(),
        aviso: "Tiempo estimado. Se recomienda añadir unos 30 minutos de margen.",
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular la hora de llegada";
      res.status(500).json({ error: mensaje });
    }
  }

  // POST /maps/hora-salida
  // Dado un origen, destino y hora de llegada deseada, devuelve a qué hora debe salir.
  // Útil para el cliente que introduce "quiero llegar a las 10:00, ¿cuándo salgo?".
  // También se usa internamente para calcular hora_salida_estimada_taxista al aceptar una reserva.
  async horaSalida(req: Request, res: Response): Promise<void> {
    const resultado = horaSalidaSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const horaSalida = await mapsService.calcularHoraSalida(
        resultado.data.origen,
        resultado.data.destino,
        new Date(resultado.data.hora_llegada)
      );
      res.status(200).json({
        hora_salida_estimada: horaSalida.toISOString(),
        aviso: "Tiempo estimado. Se recomienda añadir unos 30 minutos de margen.",
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al calcular la hora de salida";
      res.status(500).json({ error: mensaje });
    }
  }
}

export const mapsController = new MapsController();
