// =============================================================================
// STRIPE WEBHOOK HANDLER
// =============================================================================
// Los webhooks de Stripe son eventos que Stripe nos envía cuando algo ocurre
// en su sistema (onboarding completado, pago confirmado, etc.).
//
// IMPORTANTE: Este handler necesita el body de la request SIN parsear (Buffer raw),
// no como JSON, porque Stripe usa el body exacto para verificar su firma digital.
// En main.ts se arranca Nest con { rawBody: true }, lo que deja ese Buffer
// disponible en req.rawBody en todas las peticiones sin dejar de parsear
// req.body como JSON con normalidad para el resto de rutas.
//
// Sin verificación de firma, cualquiera podría enviarnos eventos falsos.
// =============================================================================

import { RawBodyRequest } from "@nestjs/common";
import { Request, Response } from "express";
import { stripe } from "../config/stripe";
import { stripeService } from "./stripe.service";
import logger from "../config/logger";


export async function stripeWebhookHandler(req: RawBodyRequest<Request>, res: Response): Promise<void> {
  const firma = req.headers["stripe-signature"];

  if (!firma) {
    res.status(400).json({ error: "Falta la firma de Stripe" });
    return;
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.error("Falta la variable de entorno STRIPE_WEBHOOK_SECRET");
    res.status(500).json({ error: "Configuración incorrecta del servidor" });
    return;
  }

  let evento;
  try {
    // Verificamos la firma usando el body raw capturado por Nest (Buffer, no el req.body ya parseado)
    evento = stripe.webhooks.constructEvent(
      req.rawBody!,
      firma,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    // Si la firma no es válida, rechazamos el evento
    res.status(400).json({ error: "Firma de webhook inválida" });
    return;
  }

  // Procesamos el evento según su tipo.
  // Siempre respondemos 200 a Stripe aunque el procesamiento interno falle:
  // si devolvemos un error, Stripe reintentará el evento indefinidamente.
  // Los errores internos los registramos en el log para revisión manual.
  try {
    switch (evento.type) {

      case "account.updated": {
        // Una cuenta Connect ha sido actualizada (puede haber completado el onboarding)
        const cuenta = evento.data.object;
        await stripeService.sincronizarCuentaDesdeWebhook(cuenta.id);
        logger.info(`Cuenta Stripe sincronizada: ${cuenta.id}`);
        break;
      }

      case "payment_intent.succeeded": {
        // El PaymentIntent fue capturado correctamente.
        // En nuestro flujo esto ocurre cuando llamamos a capturarPagoYTransferir(),
        // así que aquí solo lo registramos para trazabilidad.
        const pi = evento.data.object;
        logger.info(`PaymentIntent capturado: ${pi.id}`);
        break;
      }

      case "payment_intent.payment_failed": {
        // El pago del cliente falló (tarjeta rechazada, fondos insuficientes, etc.)
        // TODO Ticket 5.2: notificar al cliente y marcar el trayecto como cancelado
        const pi = evento.data.object;
        logger.warn(`PaymentIntent fallido: ${pi.id}`);
        break;
      }

      default:
        // Ignoramos eventos que no necesitamos gestionar
        logger.info(`Evento de Stripe ignorado: ${evento.type}`);
    }
  } catch (error) {
    logger.error({ error, evento_id: evento.id }, "Error procesando webhook de Stripe");
  }

  // Siempre respondemos 200 para que Stripe no reintente el evento
  res.status(200).json({ recibido: true });
}
