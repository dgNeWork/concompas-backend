// =============================================================================
// TIPOS Y DTOs DEL MÓDULO STRIPE
// =============================================================================
// Principio SRP: este archivo solo declara formas de datos, sin lógica.
// =============================================================================


// DTO para iniciar el onboarding de un taxista en Stripe Connect Express.
// El backend crea la cuenta y devuelve la URL a la que el taxista debe ir
// para completar el formulario de Stripe (identificación, cuenta bancaria, etc.)
export interface OnboardingRespuesta {
  url: string;               // URL de Stripe a la que redirigir al taxista
  stripe_account_id: string; // ID de la cuenta Connect recién creada (acct_...)
}

// Estado actual de la cuenta Connect del taxista.
// El taxista no puede recibir pagos hasta que onboarding_completo y payouts_habilitados sean true.
export interface EstadoCuentaStripe {
  tiene_cuenta: boolean;
  stripe_account_id: string | null;
  onboarding_completo: boolean;
  payouts_habilitados: boolean;
}

// Respuesta al crear un PaymentIntent.
// El client_secret es lo único que necesita el frontend para confirmar el pago.
// Nunca debe enviarse la clave secreta de Stripe al frontend.
export interface PaymentIntentRespuesta {
  client_secret: string;
  payment_intent_id: string;
}

// El DTO de entrada para solicitar un retiro vive junto a su schema de Zod
// en ./dto/stripe.dto.ts (RetirarIncentivoInput).

// Respuesta al procesar el retiro de incentivos.
export interface RetiroIncentivoRespuesta {
  stripe_transfer_id: string;
  importe_solicitado: number;
  importe_recibido: number;  // Puede ser menor si es Instant Payout (1%, mín. 0.40€)
  tipo_payout: "estandar" | "instantaneo";
}
