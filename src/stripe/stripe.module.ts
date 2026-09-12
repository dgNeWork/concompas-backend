import { Module } from "@nestjs/common";
import { StripeController } from "./stripe.controller";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { StripeService } from "./stripe.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule], // AuthModule exporta AuthGuard, usado para proteger StripeController
  // StripeWebhookController NO lleva AuthGuard: Stripe se autentica con su
  // propia firma, no con nuestro JWT (ver stripe-webhook.controller.ts).
  controllers: [StripeController, StripeWebhookController],
  providers: [StripeService],
  // Se exporta para que trayectos y cancelaciones lo inyecten.
  exports: [StripeService],
})
export class StripeModule {}
