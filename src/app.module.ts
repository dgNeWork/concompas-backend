import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { SupabaseModule } from "./config/supabase.module";
import { AuthModule } from "./auth/auth.module";
import { MapsModule } from "./maps/maps.module";

// Módulos de negocio pendientes de migrar a Nest (Ticket 15, en curso):
// trayectos, stripe, cancelaciones. Mientras tanto siguen montados como
// routers de Express clásicos directamente en main.ts. Se irán añadiendo aquí
// según se completen.
@Module({
  imports: [SupabaseModule, AuthModule, MapsModule],
  controllers: [AppController],
})
export class AppModule {}
