import rateLimit from "express-rate-limit";

// Límite aplicado a los endpoints de autenticación.
// 10 intentos por IP en 15 minutos evita ataques de fuerza bruta contra
// /auth/login y /auth/registro sin molestar al usuario normal.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // ventana de 15 minutos
  limit: 10,
  standardHeaders: "draft-7", // cabecera RateLimit estándar (RFC 9110)
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.",
  },
});
