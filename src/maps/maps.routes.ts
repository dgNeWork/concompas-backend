import { Router } from "express";
import { mapsController } from "./maps.controller";
import { autenticar } from "../middleware/auth.middleware";

// Rutas de mapas — todas protegidas con JWT.
// Solo usuarios autenticados pueden calcular trayectos (evita abuso de la API de Google).
const router = Router();

router.post("/trayecto", autenticar, (req, res) => mapsController.trayecto(req, res));
router.post("/hora-llegada", autenticar, (req, res) => mapsController.horaLlegada(req, res));
router.post("/hora-salida", autenticar, (req, res) => mapsController.horaSalida(req, res));

export default router;
