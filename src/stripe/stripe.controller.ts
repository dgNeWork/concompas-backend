// =============================================================================
// STRIPE CONTROLLER
// =============================================================================
// Responsabilidad única: validar datos con Zod y delegar en StripeService.
// No contiene lógica de negocio ni llamadas directas a Stripe.
// =============================================================================

import { Response } from "express";
import { z } from "zod";
import { stripeService } from "./stripe.service";
import { RequestAutenticada } from "../auth/auth.types";


const retirarIncentivoSchema = z.object({
  tipo_payout: z.enum(["estandar", "instantaneo"]),
});

const crearPaymentIntentSchema = z.object({
  trayecto_id: z.string().uuid("El ID de trayecto no es válido"),
});

const reembolsarSchema = z.object({
  trayecto_id: z.string().uuid("El ID de trayecto no es válido"),
  importe_parcial: z.number().positive().optional(),
});


export class StripeController {

  // POST /stripe/onboarding/iniciar
  // El taxista solicita empezar o continuar el onboarding de Stripe Connect.
  // Devuelve la URL a la que el frontend debe redirigir al taxista.
  async iniciarOnboarding(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas pueden iniciar el onboarding de Stripe" });
      return;
    }

    // url_retorno: base URL de la app desde la que llamar, para construir las URLs de retorno de Stripe
    const urlRetorno = (req.body.url_retorno as string) || `${req.protocol}://${req.get("host")}`;

    try {
      const resultado = await stripeService.iniciarOnboarding(req.usuario.id, urlRetorno);
      res.status(200).json(resultado);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al iniciar el onboarding";
      res.status(400).json({ error: mensaje });
    }
  }

  // GET /stripe/onboarding/estado
  // Devuelve el estado de la cuenta Stripe Connect del taxista autenticado.
  async estadoOnboarding(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas pueden consultar su estado de Stripe" });
      return;
    }

    try {
      const estado = await stripeService.obtenerEstadoCuenta(req.usuario.id);
      res.status(200).json(estado);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al obtener el estado";
      res.status(500).json({ error: mensaje });
    }
  }

  // POST /stripe/payment-intent
  // El cliente crea el PaymentIntent para una reserva concreta.
  // El frontend usa el client_secret devuelto para mostrar el formulario de pago.
  async crearPaymentIntent(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "cliente") {
      res.status(403).json({ error: "Solo los clientes pueden crear un pago" });
      return;
    }

    const resultado = crearPaymentIntentSchema.safeParse(req.body);
    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const pago = await stripeService.crearPaymentIntent(resultado.data.trayecto_id, req.usuario.id);
      res.status(201).json(pago);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al crear el pago";
      const status = mensaje.includes("permiso") ? 403 : mensaje.includes("encontrado") ? 404 : 400;
      res.status(status).json({ error: mensaje });
    }
  }

  // POST /stripe/reembolsar
  // Reembolsa el pago de un trayecto cancelado. Solo admins pueden llamarlo directamente.
  // (Los reembolsos automáticos por cancelación los gestiona el Ticket 5.2.)
  async reembolsar(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "admin") {
      res.status(403).json({ error: "Solo los administradores pueden ejecutar reembolsos manualmente" });
      return;
    }

    const resultado = reembolsarSchema.safeParse(req.body);
    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      await stripeService.reembolsarPago(resultado.data.trayecto_id, resultado.data.importe_parcial);
      res.status(200).json({ mensaje: "Reembolso procesado correctamente" });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al procesar el reembolso";
      res.status(400).json({ error: mensaje });
    }
  }

  // POST /stripe/incentivo/retirar
  // El taxista solicita retirar su saldo de incentivos acumulados.
  async retirarIncentivo(req: RequestAutenticada, res: Response): Promise<void> {
    if (req.usuario.rol !== "taxista") {
      res.status(403).json({ error: "Solo los taxistas pueden retirar incentivos" });
      return;
    }

    const resultado = retirarIncentivoSchema.safeParse(req.body);
    if (!resultado.success) {
      res.status(400).json({ error: "Datos inválidos", detalles: resultado.error.issues });
      return;
    }

    try {
      const retiro = await stripeService.retirarIncentivo(req.usuario.id, resultado.data);
      res.status(200).json(retiro);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al procesar el retiro";
      res.status(400).json({ error: mensaje });
    }
  }
}

export const stripeController = new StripeController();
