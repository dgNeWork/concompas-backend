import pino from "pino";

// En desarrollo usamos pino-pretty para logs legibles en consola.
// En producción salida JSON pura, que los servicios de logging (Railway, Datadog...) entienden bien.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    },
  }),
});

export default logger;
