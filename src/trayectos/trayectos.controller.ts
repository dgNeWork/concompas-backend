// =============================================================================
// TRAYECTOS CONTROLLER
// =============================================================================
// Responsabilidad única: recibir la request HTTP, validar los datos con Zod
// y delegar en TrayectosService. No contiene lógica de negocio.
//
// Principio SRP: el controlador no sabe cómo funciona el matching ni cómo
// se guardan los datos. Solo sabe qué formato espera y qué respuesta devolver.
// =============================================================================

import { Response } from "express";
import { z } from "zod";
import { trayectosService } from "./trayectos.service";
import { RequestAutenticada } from "../auth/auth.types";


// ----------------------------------------------------------------------------
// SCHEMAS DE VALIDACIÓN (Zod)
// Los schemas actúan como contrato entre el cliente y la API: si los datos
// no cumplen el formato, la petición se rechaza antes de tocar el servicio.
// ----------------------------------------------------------------------------

const crearTrayectoSchema = z.object({
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

const aceptarTrayectoSchema = z.object({
  vehiculo_id: z.string().uuid("El ID de vehículo no es válido").optional(),
});

const cambiarEstadoSchema = z.object({
  estado: z.enum(["en_curso", "completado", "cancelado"]),
  motivo_cancelacion: z.string().min(5).optional(),
});


// ----------------------------------------------------------------------------
// CONTROLLER
// ----------------------------------------------------------------------------

export class TrayectosController {

  // POST /trayectos
  // Crea una nueva reserva. Solo clientes pueden usar este endpoint.
  async crear(req: RequestAutenticada, res: Response): Promise<void> {
    const resultado = crearTrayectoSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    // Comprobamos que quien crea el trayecto es un cliente (doble seguro además del middleware de ruta)
    if (req.usuario.rol !== "cliente") {
      res.status(403).json({ error: "Solo los clientes pueden crear reservas" });
      return;
    }

    try {
      const trayecto = await trayectosService.crearTrayecto(req.usuario.id, resultado.data);
      res.status(201).json(trayecto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al crear el trayecto";
      res.status(500).json({ error: mensaje });
    }
  }

  // GET /trayectos
  // Lista trayectos según el rol:
  //   - cliente: sus propias reservas
  //   - taxista: reservas disponibles en su municipio
  //   - admin: todas las reservas
  async listar(req: RequestAutenticada, res: Response): Promise<void> {
    try {
      const trayectos = await trayectosService.listarTrayectos(req.usuario.id, req.usuario.rol);
      res.status(200).json(trayectos);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al listar trayectos";
      res.status(500).json({ error: mensaje });
    }
  }

  // GET /trayectos/:id
  // Devuelve el detalle de un trayecto. Verifica que el usuario tiene acceso.
  async obtener(req: RequestAutenticada, res: Response): Promise<void> {
    const id = req.params["id"];

    if (!id) {
      res.status(400).json({ error: "ID de trayecto requerido" });
      return;
    }

    try {
      const trayecto = await trayectosService.obtenerTrayecto(id as string, req.usuario.id, req.usuario.rol);
      res.status(200).json(trayecto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al obtener el trayecto";
      const status = mensaje.includes("permiso") ? 403 : mensaje.includes("encontrado") ? 404 : 500;
      res.status(status).json({ error: mensaje });
    }
  }

  // POST /trayectos/:id/aceptar
  // El taxista acepta la reserva. Entra como titular (si está libre) o suplente.
  async aceptar(req: RequestAutenticada, res: Response): Promise<void> {
    const id = req.params["id"];

    if (!id) {
      res.status(400).json({ error: "ID de trayecto requerido" });
      return;
    }

    const resultado = aceptarTrayectoSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas pueden aceptar reservas" });
      return;
    }

    try {
      const trayecto = await trayectosService.aceptarTrayecto(id as string, req.usuario.id, resultado.data);
      res.status(200).json(trayecto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al aceptar el trayecto";
      const status =
        mensaje.includes("permiso") || mensaje.includes("municipio") || mensaje.includes("completo")
          ? 403
          : mensaje.includes("encontrado")
          ? 404
          : 500;
      res.status(status).json({ error: mensaje });
    }
  }

  // PATCH /trayectos/:id/estado
  // Cambia el estado del trayecto. Las transiciones válidas dependen del rol.
  async cambiarEstado(req: RequestAutenticada, res: Response): Promise<void> {
    const id = req.params["id"];

    if (!id) {
      res.status(400).json({ error: "ID de trayecto requerido" });
      return;
    }

    const resultado = cambiarEstadoSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const trayecto = await trayectosService.cambiarEstado(
        id as string,
        req.usuario.id,
        req.usuario.rol,
        resultado.data
      );
      res.status(200).json(trayecto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al cambiar el estado";
      const status =
        mensaje.includes("permiso") || mensaje.includes("Solo el taxista")
          ? 403
          : mensaje.includes("encontrado")
          ? 404
          : 400;
      res.status(status).json({ error: mensaje });
    }
  }
}

export const trayectosController = new TrayectosController();
