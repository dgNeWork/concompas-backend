import { z } from "zod";

// Mismo schema de validación que usaba el AuthController de Express.
// Vive aquí (junto al resto de DTOs) en vez de en el controlador, porque en
// Nest los DTOs son ciudadanos de primera clase que se reutilizan en pipes,
// documentación y tests.
export const registroSchema = z.object({
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

export type RegistroDto = z.infer<typeof registroSchema>;
