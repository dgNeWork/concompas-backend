import "reflect-metadata";
import dotenv from "dotenv";
// Cargamos las variables de entorno antes de importar cualquier otro módulo.
// Si dotenv.config() se llamara después, supabase.ts leería process.env vacío y lanzaría error.
dotenv.config();

import helmet from "helmet";
import pinoHttp from "pino-http";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import logger from "./config/logger";

// Módulos que todavía no se han migrado a NestJS (Ticket 15, en curso).
// Se montan como routers de Express clásicos mientras se completa la migración
// módulo a módulo; se irán retirando de aquí según cada uno pase a Nest.
import mapsRoutes from "./maps/maps.routes";
import trayectosRoutes from "./trayectos/trayectos.routes";
import stripeRoutes from "./stripe/stripe.routes";
import cancelacionesRoutes from "./cancelaciones/cancelaciones.routes";
import { stripeWebhookHandler } from "./stripe/stripe.webhook";

async function bootstrap() {
  // rawBody: true expone req.rawBody (Buffer) en todas las peticiones sin dejar
  // de parsear req.body como JSON con normalidad. Lo necesita el webhook de
  // Stripe para verificar la firma con el body exacto que envió Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Logging de cada request: método, ruta, status y tiempo de respuesta
  app.use(pinoHttp({ logger }));

  // Cabeceras HTTP de seguridad: protege contra XSS, clickjacking, MIME sniffing, etc.
  app.use(helmet());

  // CORS: en desarrollo aceptamos cualquier origen (Postman, frontend local...).
  // En producción solo se admiten los dominios configurados en CORS_ORIGIN (separados por coma).
  app.enableCors({
    origin:
      process.env.NODE_ENV === "production"
        ? (process.env.CORS_ORIGIN || "").split(",")
        : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Normaliza los errores de los controladores Nest al mismo formato { error }
  // que ya devolvía el backend en Express (ver el propio filtro para el detalle).
  app.useGlobalFilters(new HttpExceptionFilter());

  // TODO(Ticket 15): retirar cada línea de aquí abajo según se migre su módulo a Nest.
  app.use("/stripe/webhook", stripeWebhookHandler);
  app.use("/maps", mapsRoutes);
  app.use("/trayectos", trayectosRoutes);
  app.use("/stripe", stripeRoutes);
  app.use("/cancelaciones", cancelacionesRoutes);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.info(`Servidor corriendo en el puerto ${port}`);
}

bootstrap();
