import { Module } from "@nestjs/common";
import { TrayectosController } from "./trayectos.controller";
import { TrayectosService } from "./trayectos.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule], // AuthModule exporta AuthGuard, usado para proteger estas rutas
  controllers: [TrayectosController],
  providers: [TrayectosService],
})
export class TrayectosModule {}
