import { Router } from "express";
import { cancelacionesController } from "./cancelaciones.controller";
import { autenticar } from "../middleware/auth.middleware";

// Router de cancelaciones.
// La cancelación de un trayecto en sí sigue siendo PATCH /trayectos/:id/estado;
// este módulo solo gestiona el ciclo de vida de las penalizaciones generadas.
// Todas las rutas requieren JWT válido.

const router = Router();

// El taxista ve sus propias penalizaciones
router.get("/mis-penalizaciones", autenticar, (req, res) => cancelacionesController.listarPropias(req as any, res));

// El taxista justifica una penalización propia
router.patch("/:id/justificar", autenticar, (req, res) => cancelacionesController.justificar(req as any, res));

// El admin resuelve una penalización pendiente
router.patch("/:id/resolver", autenticar, (req, res) => cancelacionesController.resolver(req as any, res));

export default router;
