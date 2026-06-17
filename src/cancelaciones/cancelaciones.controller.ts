// =============================================================================
// CANCELACIONES CONTROLLER
// =============================================================================
// Responsabilidad única: recibir la request HTTP, validar los datos con Zod y
// delegar en CancelacionesService. No contiene lógica de negocio.
//
// La cancelación de un trayecto en sí (PATCH /trayectos/:id/estado) sigue
// viviendo en trayectos.controller.ts — este módulo solo gestiona lo que pasa
// DESPUÉS de generarse una penalización: justificarla y resolverla.
// =============================================================================

import { Response } from "express";
import { z } from "zod";
import { cancelacionesService } from "./cancelaciones.service";
import { RequestAutenticada } from "../auth/auth.types";


// ----------------------------------------------------------------------------
// SCHEMAS DE VALIDACIÓN (Zod)
// ----------------------------------------------------------------------------

const justificarSchema = z.object({
  justificacion: z.string().min(10, "La justificación debe tener al menos 10 caracteres").max(1000),
});

const resolverSchema = z.object({
  estado: z.enum(["descontada", "cancelada_con_justificacion"]),
});


// ----------------------------------------------------------------------------
// CONTROLLER
// ----------------------------------------------------------------------------

export class CancelacionesController {

  // GET /cancelaciones/mis-penalizaciones
  // El taxista ve sus propias penalizaciones (para encontrar el ID que necesita
  // al justificar, y para conocer su situación económica).
  async listarPropias(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas tienen penalizaciones" });
      return;
    }

    try {
      const penalizaciones = await cancelacionesService.listarPenalizacionesTaxista(req.usuario.id);
      res.status(200).json(penalizaciones);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al listar penalizaciones";
      res.status(500).json({ error: mensaje });
    }
  }

  // PATCH /cancelaciones/:id/justificar
  // El taxista penalizado añade un texto explicativo para que el admin lo revise.
  async justificar(req: RequestAutenticada, res: Response): Promise<void> {
    const id = req.params["id"];

    if (!id) {
      res.status(400).json({ error: "ID de penalización requerido" });
      return;
    }

    const resultado = justificarSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas pueden justificar penalizaciones" });
      return;
    }

    try {
      const penalizacion = await cancelacionesService.justificarPenalizacion(
        id as string,
        req.usuario.id,
        resultado.data
      );
      res.status(200).json(penalizacion);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al justificar la penalización";
      const status =
        mensaje.includes("permiso")
          ? 403
          : mensaje.includes("encontrada")
          ? 404
          : mensaje.includes("pendiente")
          ? 400
          : 500;
      res.status(status).json({ error: mensaje });
    }
  }

  // PATCH /cancelaciones/:id/resolver
  // El admin resuelve una penalización pendiente: la deja descontada o la anula
  // por justificación válida.
  async resolver(req: RequestAutenticada, res: Response): Promise<void> {
    const id = req.params["id"];

    if (!id) {
      res.status(400).json({ error: "ID de penalización requerido" });
      return;
    }

    const resultado = resolverSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    if (req.usuario.rol !== "admin") {
      res.status(403).json({ error: "Solo el admin puede resolver penalizaciones" });
      return;
    }

    try {
      const penalizacion = await cancelacionesService.resolverPenalizacion(id as string, resultado.data);
      res.status(200).json(penalizacion);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al resolver la penalización";
      const status = mensaje.includes("encontrada") ? 404 : mensaje.includes("resuelta") ? 400 : 500;
      res.status(status).json({ error: mensaje });
    }
  }
}

export const cancelacionesController = new CancelacionesController();
