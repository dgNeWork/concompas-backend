import { z } from "zod";

export const retirarIncentivoSchema = z.object({
  tipo_payout: z.enum(["estandar", "instantaneo"]),
});

export type RetirarIncentivoInput = z.infer<typeof retirarIncentivoSchema>;

export const crearPaymentIntentSchema = z.object({
  trayecto_id: z.string().uuid("El ID de trayecto no es válido"),
});

export type CrearPaymentIntentInput = z.infer<typeof crearPaymentIntentSchema>;

export const reembolsarSchema = z.object({
  trayecto_id: z.string().uuid("El ID de trayecto no es válido"),
  importe_parcial: z.number().positive().optional(),
});

export type ReembolsarInput = z.infer<typeof reembolsarSchema>;
