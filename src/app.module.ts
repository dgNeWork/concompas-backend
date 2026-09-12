import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { SupabaseModule } from "./config/supabase.module";
import { AuthModule } from "./auth/auth.module";
import { MapsModule } from "./maps/maps.module";
import { TrayectosModule } from "./trayectos/trayectos.module";
import { StripeModule } from "./stripe/stripe.module";

// Módulo de negocio pendiente de migrar a Nest (Ticket 15, en curso):
// cancelaciones. Mientras tanto sigue montado como router de Express clásico
// directamente en main.ts.
//
// El webhook de Stripe (POST /stripe/webhook) NO está en StripeModule: sigue
// siendo un handler de Express aparte, montado en main.ts, porque necesita
// el body sin parsear (ver stripe.webhook.ts).
@Module({
  imports: [SupabaseModule, AuthModule, MapsModule, TrayectosModule, StripeModule],
  controllers: [AppController],
})
export class AppModule {}
