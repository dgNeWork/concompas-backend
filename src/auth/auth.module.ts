import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { authRateLimit } from "../middleware/rate-limit.middleware";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  // AuthGuard se exporta para que otros módulos (trayectos, stripe...) lo
  // reutilicen a medida que se vayan migrando a Nest, en vez de reescribirlo.
  exports: [AuthService, AuthGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 10 intentos cada 15 minutos contra /auth, igual que en Express.
    consumer.apply(authRateLimit).forRoutes(AuthController);
  }
}
