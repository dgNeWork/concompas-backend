import Stripe from "stripe";

// Cliente Stripe centralizado — mismo patrón Singleton que supabase.ts.
// Se inicializa una sola vez y se reutiliza en todo el backend.
// Usamos la versión de API más reciente para tener acceso a Connect Express y Instant Payouts.
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta la variable de entorno STRIPE_SECRET_KEY");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-05-27.dahlia",
});
