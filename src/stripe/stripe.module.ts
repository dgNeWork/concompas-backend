import { Module } from "@nestjs/common";
import { StripeController } from "./stripe.controller";
import { StripeService } from "./stripe.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule], // AuthModule exporta AuthGuard, usado para proteger estas rutas
  controllers: [StripeController],
  providers: [StripeService],
  // Se exporta para que trayectos y cancelaciones lo inyecten cuando se migren.
  exports: [StripeService],
})
export class StripeModule {}
