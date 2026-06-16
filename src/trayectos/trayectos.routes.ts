import { Router } from "express";
import { trayectosController } from "./trayectos.controller";
import { autenticar } from "../middleware/auth.middleware";

// Router de trayectos.
// Todas las rutas requieren JWT válido — no hay endpoints públicos en este módulo.
// La autorización fina (qué rol puede hacer qué) se gestiona en el servicio y el controlador.

const router = Router();

// Crear una nueva reserva (solo clientes)
router.post("/", autenticar, (req, res) => trayectosController.crear(req as any, res));

// Listar trayectos — el resultado varía según el rol del usuario autenticado
router.get("/", autenticar, (req, res) => trayectosController.listar(req as any, res));

// Detalle de un trayecto concreto
router.get("/:id", autenticar, (req, res) => trayectosController.obtener(req as any, res));

// El taxista acepta una reserva (se asigna como titular o suplente)
router.post("/:id/aceptar", autenticar, (req, res) => trayectosController.aceptar(req as any, res));

// Cambiar el estado de un trayecto (confirmado, en_curso, completado, cancelado)
router.patch("/:id/estado", autenticar, (req, res) => trayectosController.cambiarEstado(req as any, res));

export default router;
