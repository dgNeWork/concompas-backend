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

// Módulo que todavía no se ha migrado a NestJS (Ticket 15, en curso).
// Se monta como router de Express clásico mientras se completa la migración;
// se retirará de aquí cuando pase a Nest.
import cancelacionesRoutes from "./cancelaciones/cancelaciones.routes";
// El webhook de Stripe se queda siempre aquí, aunque el resto del módulo ya
// esté en Nest: necesita el body sin parsear (ver stripe.webhook.ts).
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

  app.use("/stripe/webhook", stripeWebhookHandler);

  // TODO(Ticket 15): retirar según se migre cancelaciones a Nest.
  app.use("/cancelaciones", cancelacionesRoutes);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.info(`Servidor corriendo en el puerto ${port}`);
}

bootstrap();
