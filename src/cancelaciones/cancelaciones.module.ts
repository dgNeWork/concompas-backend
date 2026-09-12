import { Module } from "@nestjs/common";
import { CancelacionesController } from "./cancelaciones.controller";
import { CancelacionesService } from "./cancelaciones.service";
import { AuthModule } from "../auth/auth.module";
import { StripeModule } from "../stripe/stripe.module";

@Module({
  imports: [AuthModule, StripeModule], // AuthGuard y StripeService respectivamente
  controllers: [CancelacionesController],
  providers: [CancelacionesService],
  // Se exporta para que trayectos lo inyecte (aceptarTrayecto, cambiarEstado).
  exports: [CancelacionesService],
})
export class CancelacionesModule {}
