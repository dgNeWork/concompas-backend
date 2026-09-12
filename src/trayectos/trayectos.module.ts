import { Module } from "@nestjs/common";
import { TrayectosController } from "./trayectos.controller";
import { TrayectosService } from "./trayectos.service";
import { AuthModule } from "../auth/auth.module";
import { MapsModule } from "../maps/maps.module";
import { StripeModule } from "../stripe/stripe.module";
import { CancelacionesModule } from "../cancelaciones/cancelaciones.module";

@Module({
  imports: [AuthModule, MapsModule, StripeModule, CancelacionesModule],
  controllers: [TrayectosController],
  providers: [TrayectosService],
})
export class TrayectosModule {}
