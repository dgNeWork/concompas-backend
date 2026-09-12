import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Email no válido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export type LoginDto = z.infer<typeof loginSchema>;
