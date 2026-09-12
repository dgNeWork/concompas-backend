// =============================================================================
// STRIPE WEBHOOK CONTROLLER
// =============================================================================
// Los webhooks de Stripe son eventos que Stripe nos envía cuando algo ocurre
// en su sistema (onboarding completado, pago confirmado, etc.).
//
// IMPORTANTE: este endpoint NO lleva AuthGuard. Stripe no manda un JWT nuestro:
// autentica la petición con su propia firma digital sobre el body EXACTO que
// envió, por eso usamos req.rawBody (Buffer) en vez de req.body (ya parseado).
// Nest expone req.rawBody en todas las rutas gracias a { rawBody: true } en
// NestFactory.create() (ver main.ts), así que no hace falta ningún middleware
// especial aquí como en Express.
//
// Sin verificación de firma, cualquiera podría enviarnos eventos falsos.
// =============================================================================

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { stripe } from "../config/stripe";
import { StripeService } from "./stripe.service";
import logger from "../config/logger";

@Controller("stripe/webhook")
export class StripeWebhookController {
  constructor(private readonly stripeService: StripeService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async recibir(@Req() req: RawBodyRequest<Request>) {
    const firma = req.headers["stripe-signature"];

    if (!firma) {
      throw new BadRequestException("Falta la firma de Stripe");
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      logger.error("Falta la variable de entorno STRIPE_WEBHOOK_SECRET");
      throw new InternalServerErrorException("Configuración incorrecta del servidor");
    }

    let evento;
    try {
      // Verificamos la firma usando el body raw capturado por Nest (Buffer, no el req.body ya parseado)
      evento = stripe.webhooks.constructEvent(req.rawBody!, firma, process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      // Si la firma no es válida, rechazamos el evento
      throw new BadRequestException("Firma de webhook inválida");
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
          await this.stripeService.sincronizarCuentaDesdeWebhook(cuenta.id);
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
    return { recibido: true };
  }
}
