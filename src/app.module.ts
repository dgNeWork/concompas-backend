import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { SupabaseModule } from "./config/supabase.module";
import { AuthModule } from "./auth/auth.module";
import { MapsModule } from "./maps/maps.module";
import { TrayectosModule } from "./trayectos/trayectos.module";
import { StripeModule } from "./stripe/stripe.module";
import { CancelacionesModule } from "./cancelaciones/cancelaciones.module";

@Module({
  imports: [
    SupabaseModule,
    AuthModule,
    MapsModule,
    TrayectosModule,
    StripeModule,
    CancelacionesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
