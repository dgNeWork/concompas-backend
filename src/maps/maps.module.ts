import { Module } from "@nestjs/common";
import { MapsController } from "./maps.controller";
import { MapsService } from "./maps.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule], // AuthModule exporta AuthGuard, usado para proteger estas rutas
  controllers: [MapsController],
  providers: [MapsService],
  // Se exporta para que trayectos lo inyecte al calcular duraciones y horas estimadas.
  exports: [MapsService],
})
export class MapsModule {}
