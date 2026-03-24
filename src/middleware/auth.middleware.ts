import { Request, Response, NextFunction } from "express";
import { authService } from "../auth/auth.service";
import { RequestAutenticada } from "../auth/auth.types";

// Middleware de autenticación.
// Se ejecuta antes del controlador en las rutas protegidas.
// Responsabilidad única: verificar que el token JWT es válido y adjuntar el usuario a la request.
//
// Un middleware en Express es una función que recibe (req, res, next).
// Si todo va bien, llama a next() para que la ejecución continúe hacia el controlador.
// Si algo falla, responde directamente con un error y el controlador nunca se ejecuta.
//
// Uso en las rutas: router.get("/ruta-protegida", autenticar, controlador)

export async function autenticar(req: Request, res: Response, next: NextFunction): Promise<void> {
  // El token se envía en la cabecera Authorization con el formato: "Bearer <token>"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "No autorizado: falta el token de autenticación" });
    return;
  }

  // Extraemos el token eliminando el prefijo "Bearer "
  const token = authHeader.split(" ")[1];

  try {
    // Verificamos el token contra Supabase y obtenemos los datos del usuario.
    // Si el token es inválido o ha expirado, verificarToken lanza un error
    // y caemos al catch, respondiendo con 401 sin llegar al controlador.
    const usuario = await authService.verificarToken(token);

    // Adjuntamos el usuario a la request para que el controlador pueda acceder a él
    // sin necesidad de volver a consultar la base de datos.
    (req as RequestAutenticada).usuario = usuario;

    next();
  } catch (error) {
    res.status(401).json({ error: "No autorizado: token inválido o expirado" });
  }
}
