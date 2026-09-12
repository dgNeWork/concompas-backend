import { Global, Module } from "@nestjs/common";
import { SupabaseService } from "./supabase.service";

// Módulo global: casi todos los módulos de negocio (auth, trayectos, stripe...)
// necesitan acceso a Supabase, así que lo marcamos @Global() para no tener que
// importarlo explícitamente en cada módulo que lo use.
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
