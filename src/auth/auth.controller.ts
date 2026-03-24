import { Request, Response } from "express";
import { z } from "zod";
import { authService } from "./auth.service";
import { RequestAutenticada } from "./auth.types";

// Schemas de validación con Zod.
// Cada schema define la forma exacta que esperamos del body de la petición.
// Si el body no cumple el schema, Zod devuelve errores detallados por campo
// sin que tengamos que escribir validaciones manuales (principio DRY).

const registroSchema = z.object({
  email: z.email("Email no válido"),
  password: z.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .refine(val => /[0-9]/.test(val), "Debe contener al menos un número")
    .refine(val => /[a-z]/.test(val), "Debe contener al menos una letra minúscula")
    .refine(val => /[A-Z]/.test(val), "Debe contener al menos una letra mayúscula")
    .refine(val => /[-_/&%$?¿!¡<>]/.test(val), "Debe contener al menos un carácter especial: - _ / & % $ ? ¿ ! ¡ < >"),
  nombre: z.string().min(1, "El nombre es obligatorio"),
  apellidos: z.string().min(1, "Los apellidos son obligatorios"),
  documento_identidad: z.string().min(1, "El documento de identidad es obligatorio"),
  telefono: z.string().min(9, "El teléfono no es válido"),
  rol: z.enum(["cliente", "taxista"]),
  // Campos opcionales según el rol — el servicio los ignora si no corresponden
  direccion_habitual: z.string().optional(),
  es_titular: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.email("Email no válido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

// AuthController gestiona el ciclo request → respuesta de cada endpoint.
// Responsabilidad única: recibir la petición, validar el body, llamar al servicio
// y devolver la respuesta HTTP correcta. No contiene lógica de negocio.

export class AuthController {

  // POST /auth/registro
  async registro(req: Request, res: Response): Promise<void> {
    // Validamos el body contra el schema. safeParse no lanza excepción si falla,
    // sino que devuelve { success: false, error } para que lo gestionemos nosotros.
    const resultado = registroSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({
        error: "Datos de registro inválidos",
        detalles: resultado.error.issues,
      });
      return;
    }

    try {
      const usuario = await authService.registrar(resultado.data);
      res.status(201).json({
        mensaje: "Usuario registrado correctamente",
        usuario,
      });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error inesperado al registrar";
      res.status(400).json({ error: mensaje });
    }
  }

  // POST /auth/login
  async login(req: Request, res: Response): Promise<void> {
    const resultado = loginSchema.safeParse(req.body);

    if (!resultado.success) {
      res.status(400).json({
        error: "Datos de login inválidos",
        detalles: resultado.error.issues,
      });
      return;
    }

    try {
      const sesion = await authService.login(resultado.data);
      res.status(200).json(sesion);
    } catch (error) {
      // Devolvemos siempre el mismo mensaje genérico, sin distinguir entre
      // "usuario no existe" y "contraseña incorrecta". Dar esa información
      // permitiría a un atacante saber qué emails están registrados (enumeración).
      res.status(401).json({ error: "Credenciales incorrectas" });
    }
  }

  // POST /auth/logout — ruta protegida
  // El middleware ya ha verificado el token y ha adjuntado req.usuario antes de llegar aquí.
  async logout(req: Request, res: Response): Promise<void> {
    const reqAuth = req as RequestAutenticada;

    try {
      await authService.logout(reqAuth.usuario.id);
      res.status(200).json({ mensaje: "Sesión cerrada correctamente" });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error al cerrar sesión";
      res.status(500).json({ error: mensaje });
    }
  }

  // GET /auth/me — ruta protegida
  // El middleware ya ha verificado el token y cargado el perfil en req.usuario,
  // así que solo lo devolvemos sin necesidad de ir a la base de datos de nuevo.
  async me(req: Request, res: Response): Promise<void> {
    const reqAuth = req as RequestAutenticada;
    res.status(200).json({ usuario: reqAuth.usuario });
  }
}

export const authController = new AuthController();
