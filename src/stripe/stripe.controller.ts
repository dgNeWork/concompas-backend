// =============================================================================
// STRIPE CONTROLLER
// =============================================================================
// Responsabilidad única: validar datos (delegado al pipe) y llamar a StripeService.
// No contiene lógica de negocio ni llamadas directas a Stripe.
// El webhook NO está aquí: sigue siendo un handler de Express aparte porque
// necesita el body sin parsear (ver stripe.webhook.ts).
// =============================================================================

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { StripeService } from "./stripe.service";
import { AuthGuard } from "../auth/auth.guard";
import { Usuario } from "../auth/decorators/usuario.decorator";
import { UsuarioAutenticado } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  retirarIncentivoSchema,
  RetirarIncentivoInput,
  crearPaymentIntentSchema,
  CrearPaymentIntentInput,
  reembolsarSchema,
  ReembolsarInput,
} from "./dto/stripe.dto";

@Controller("stripe")
@UseGuards(AuthGuard)
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  // --- Onboarding del taxista ---

  // POST /stripe/onboarding/iniciar
  // El taxista solicita empezar o continuar el onboarding de Stripe Connect.
  // Devuelve la URL a la que el frontend debe redirigir al taxista.
  @Post("onboarding/iniciar")
  async iniciarOnboarding(@Req() req: Request, @Usuario() usuario: UsuarioAutenticado) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas pueden iniciar el onboarding de Stripe");
    }

    // url_retorno: base URL de la app desde la que llamar, para construir las URLs de retorno de Stripe
    const urlRetorno = (req.body?.url_retorno as string) || `${req.protocol}://${req.get("host")}`;

    try {
      return await this.stripeService.iniciarOnboarding(usuario.id, urlRetorno);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al iniciar el onboarding";
      throw new BadRequestException(mensaje);
    }
  }

  // GET /stripe/onboarding/estado
  // Devuelve el estado de la cuenta Stripe Connect del taxista autenticado.
  @Get("onboarding/estado")
  async estadoOnboarding(@Usuario() usuario: UsuarioAutenticado) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas pueden consultar su estado de Stripe");
    }

    try {
      return await this.stripeService.obtenerEstadoCuenta(usuario.id);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al obtener el estado";
      throw new InternalServerErrorException(mensaje);
    }
  }

  // --- Pagos ---

  // POST /stripe/payment-intent
  // El cliente crea el PaymentIntent para una reserva concreta.
  // El frontend usa el client_secret devuelto para mostrar el formulario de pago.
  @Post("payment-intent")
  @HttpCode(HttpStatus.CREATED)
  async crearPaymentIntent(
    @Body(new ZodValidationPipe(crearPaymentIntentSchema)) dto: CrearPaymentIntentInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "cliente") {
      throw new ForbiddenException("Solo los clientes pueden crear un pago");
    }

    try {
      return await this.stripeService.crearPaymentIntent(dto.trayecto_id, usuario.id);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al crear el pago";
      const status = mensaje.includes("permiso")
        ? HttpStatus.FORBIDDEN
        : mensaje.includes("encontrado")
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      throw new HttpException({ error: mensaje }, status);
    }
  }

  // POST /stripe/reembolsar
  // Reembolsa el pago de un trayecto cancelado. Solo admins pueden llamarlo directamente.
  // (Los reembolsos automáticos por cancelación los gestiona el Ticket 5.2.)
  @Post("reembolsar")
  async reembolsar(
    @Body(new ZodValidationPipe(reembolsarSchema)) dto: ReembolsarInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "admin") {
      throw new ForbiddenException("Solo los administradores pueden ejecutar reembolsos manualmente");
    }

    try {
      await this.stripeService.reembolsarPago(dto.trayecto_id, dto.importe_parcial);
      return { mensaje: "Reembolso procesado correctamente" };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al procesar el reembolso";
      throw new BadRequestException(mensaje);
    }
  }

  // --- Incentivos del taxista ---

  // POST /stripe/incentivo/retirar
  // El taxista solicita retirar su saldo de incentivos acumulados.
  @Post("incentivo/retirar")
  async retirarIncentivo(
    @Body(new ZodValidationPipe(retirarIncentivoSchema)) dto: RetirarIncentivoInput,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (usuario.rol !== "taxista") {
      throw new ForbiddenException("Solo los taxistas pueden retirar incentivos");
    }

    try {
      return await this.stripeService.retirarIncentivo(usuario.id, dto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al procesar el retiro";
      throw new BadRequestException(mensaje);
    }
  }
}
