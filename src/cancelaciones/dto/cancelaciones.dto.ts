import { z } from "zod";

export const justificarSchema = z.object({
  justificacion: z.string().min(10, "La justificación debe tener al menos 10 caracteres").max(1000),
});

export type JustificarInput = z.infer<typeof justificarSchema>;

export const resolverSchema = z.object({
  estado: z.enum(["descontada", "cancelada_con_justificacion"]),
});

export type ResolverInput = z.infer<typeof resolverSchema>;
