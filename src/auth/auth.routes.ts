import { Router } from "express";
import { authController } from "./auth.controller";
import { autenticar } from "../middleware/auth.middleware";

// Router de autenticación.
// Agrupa todos los endpoints bajo el prefijo /auth que se registra en index.ts.
// Principio SRP: este archivo solo define las rutas y qué middleware aplica a cada una.

const router = Router();

// Rutas públicas — cualquiera puede llamarlas sin token
router.post("/registro", (req, res) => authController.registro(req, res));
router.post("/login", (req, res) => authController.login(req, res));

// Rutas protegidas — el middleware autenticar() verifica el JWT antes de llegar al controlador.
// Si el token no es válido o no se envía, el middleware responde con 401 y el controlador nunca se ejecuta.
router.post("/logout", autenticar, (req, res) => authController.logout(req, res));
router.get("/me", autenticar, (req, res) => authController.me(req, res));

export default router;
