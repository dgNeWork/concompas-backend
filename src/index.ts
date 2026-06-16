import dotenv from "dotenv";
// Cargamos las variables de entorno antes de importar cualquier otro módulo.
// Si dotenv.config() se llamara después, supabase.ts leería process.env vacío y lanzaría error.
dotenv.config();

import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import authRoutes from "./auth/auth.routes";
import mapsRoutes from "./maps/maps.routes";
import trayectosRoutes from "./trayectos/trayectos.routes";
import { authRateLimit } from "./middleware/rate-limit.middleware";
import logger from "./config/logger";

const app = express();

// Logging de cada request: método, ruta, status y tiempo de respuesta
app.use(pinoHttp({ logger }));

// Cabeceras HTTP de seguridad: protege contra XSS, clickjacking, MIME sniffing, etc.
app.use(helmet());

// CORS: en desarrollo aceptamos cualquier origen (Postman, Expo, localhost...).
// En producción solo se admiten los dominios configurados en CORS_ORIGIN (separados por coma).
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? (process.env.CORS_ORIGIN || "").split(",")
        : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Permitimos que el servidor entienda JSON en el cuerpo de las peticiones
app.use(express.json());

// Puerto donde escucha el servidor — lo leeremos de las variables de entorno en producción
const PORT = process.env.PORT || 3000;

// Ruta de healthcheck para verificar que el servidor está en pie
app.get("/", (req, res) => {
  res.json({ message: "ConCompas API funcionando" });
});

// Rate limiting solo en autenticación + rutas de autenticación
app.use("/auth", authRateLimit);
app.use("/auth", authRoutes);

// Rutas de cálculo de trayectos con Google Maps
app.use("/maps", mapsRoutes);

// Rutas del módulo de trayectos concertados (CRUD + matching de taxistas)
app.use("/trayectos", trayectosRoutes);

// Arrancamos el servidor
app.listen(PORT, () => {
  logger.info(`Servidor corriendo en el puerto ${PORT}`);
});
