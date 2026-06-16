import { Router } from "express";
import { stripeController } from "./stripe.controller";
import { autenticar } from "../middleware/auth.middleware";

// Router de Stripe. El webhook NO está aquí: se registra directamente en index.ts
// antes de express.json() porque necesita el body sin parsear.

const router = Router();

// --- Onboarding del taxista ---
router.post("/onboarding/iniciar", autenticar, (req, res) => stripeController.iniciarOnboarding(req as any, res));
router.get("/onboarding/estado", autenticar, (req, res) => stripeController.estadoOnboarding(req as any, res));

// --- Pagos ---
router.post("/payment-intent", autenticar, (req, res) => stripeController.crearPaymentIntent(req as any, res));
router.post("/reembolsar", autenticar, (req, res) => stripeController.reembolsar(req as any, res));

// --- Incentivos del taxista ---
router.post("/incentivo/retirar", autenticar, (req, res) => stripeController.retirarIncentivo(req as any, res));

export default router;
