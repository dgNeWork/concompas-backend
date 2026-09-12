// =============================================================================
// STRIPE SERVICE
// =============================================================================
// Toda la lógica de integración con Stripe vive aquí.
// El resto del sistema (trayectos, cancelaciones) llama a este servicio sin
// conocer los detalles de la API de Stripe. Principio SRP + DIP.
//
// Responsabilidades:
//   1. Onboarding de taxistas en Stripe Connect Express
//   2. Crear PaymentIntents (pago retenido, no capturado) al reservar
//   3. Capturar el pago y transferir al taxista al completar el servicio
//   4. Reembolsar al cliente cuando cancela con derecho a devolución
//   5. Gestionar el retiro del wallet de incentivos del taxista
// =============================================================================

import { Injectable } from "@nestjs/common";
import { stripe } from "../config/stripe";
import { SupabaseService } from "../config/supabase.service";
import { RetirarIncentivoInput } from "./dto/stripe.dto";
import {
  OnboardingRespuesta,
  EstadoCuentaStripe,
  PaymentIntentRespuesta,
  RetiroIncentivoRespuesta,
} from "./stripe.types";

@Injectable()
export class StripeService {
  constructor(private readonly supabaseService: SupabaseService) {}

  // ---------------------------------------------------------------------------
  // INICIAR ONBOARDING
  // Crea una cuenta Stripe Connect Express para el taxista y devuelve la URL
  // del formulario de Stripe donde el taxista introduce sus datos bancarios,
  // identificación y acepta los términos de Stripe.
  //
  // Si el taxista ya tiene cuenta (onboarding interrumpido), genera un nuevo
  // enlace para que pueda continuar donde lo dejó.
  // ---------------------------------------------------------------------------
  async iniciarOnboarding(
    taxistaId: string,
    urlRetorno: string
  ): Promise<OnboardingRespuesta> {
    const admin = this.supabaseService.admin;

    // Comprobamos si el taxista ya tiene una cuenta Connect en nuestra BD
    const { data: cuentaExistente } = await admin
      .from("taxistas_stripe_cuenta")
      .select("stripe_account_id, onboarding_completo")
      .eq("taxista_id", taxistaId)
      .single();

    // Si ya completó el onboarding, no tiene sentido volver a iniciarlo
    if (cuentaExistente?.onboarding_completo) {
      throw new Error("El taxista ya ha completado el onboarding de Stripe");
    }

    let stripeAccountId: string;

    if (cuentaExistente?.stripe_account_id) {
      // El taxista interrumpió el onboarding; reutilizamos la cuenta existente
      stripeAccountId = cuentaExistente.stripe_account_id;
    } else {
      // Primera vez: creamos una cuenta Connect Express nueva
      // Express es el tipo más adecuado para taxistas: Stripe gestiona el onboarding
      // completo y la plataforma no necesita implementar el flujo de KYC manual.
      const cuenta = await stripe.accounts.create({
        type: "express",
        country: "ES",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        settings: {
          payouts: {
            // Permitimos payouts manuales para que el taxista elija cuándo retirar
            schedule: { interval: "manual" },
          },
        },
      });

      stripeAccountId = cuenta.id;

      // Guardamos la cuenta en nuestra BD inmediatamente para no perderla
      // si el taxista cierra el navegador antes de completar el onboarding
      const { error } = await admin
        .from("taxistas_stripe_cuenta")
        .insert({
          taxista_id: taxistaId,
          stripe_account_id: stripeAccountId,
          onboarding_completo: false,
          payouts_habilitados: false,
        });

      if (error) {
        throw new Error(`Error al guardar la cuenta Stripe: ${error.message}`);
      }
    }

    // Generamos el enlace de onboarding. Tiene un TTL de 5 minutos.
    // refresh_url: si el link caduca, redirigimos aquí para generar uno nuevo
    // return_url: cuando el taxista termina el formulario de Stripe, vuelve aquí
    const enlace = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${urlRetorno}/stripe/onboarding/refresh`,
      return_url: `${urlRetorno}/stripe/onboarding/completado`,
      type: "account_onboarding",
    });

    return { url: enlace.url, stripe_account_id: stripeAccountId };
  }


  // ---------------------------------------------------------------------------
  // ESTADO DE LA CUENTA STRIPE
  // Devuelve si el taxista tiene cuenta, si completó el onboarding y si
  // tiene payouts habilitados (necesario para recibir transferencias).
  // ---------------------------------------------------------------------------
  async obtenerEstadoCuenta(taxistaId: string): Promise<EstadoCuentaStripe> {
    const { data } = await this.supabaseService.admin
      .from("taxistas_stripe_cuenta")
      .select("stripe_account_id, onboarding_completo, payouts_habilitados")
      .eq("taxista_id", taxistaId)
      .single();

    if (!data) {
      return {
        tiene_cuenta: false,
        stripe_account_id: null,
        onboarding_completo: false,
        payouts_habilitados: false,
      };
    }

    return {
      tiene_cuenta: true,
      stripe_account_id: data.stripe_account_id,
      onboarding_completo: data.onboarding_completo,
      payouts_habilitados: data.payouts_habilitados,
    };
  }


  // ---------------------------------------------------------------------------
  // CREAR PAYMENT INTENT
  // Crea un PaymentIntent con captura manual: el dinero queda retenido en la
  // tarjeta del cliente pero no se cobra hasta que el servicio se complete.
  // Si no hay taxi disponible ("Para Ya!") o el cliente cancela, el PaymentIntent
  // se cancela y la retención se libera sin coste para el cliente.
  //
  // El client_secret resultante se envía al frontend, que lo usa con el SDK
  // de Stripe para mostrar el formulario de pago sin que los datos de la tarjeta
  // pasen nunca por nuestros servidores (cumplimiento PCI).
  // ---------------------------------------------------------------------------
  async crearPaymentIntent(
    trayectoId: string,
    clienteId: string
  ): Promise<PaymentIntentRespuesta> {
    const admin = this.supabaseService.admin;

    // Leemos el trayecto para obtener el importe y verificar que pertenece al cliente
    const { data: trayecto, error } = await admin
      .from("trayectos")
      .select("precio_cliente, cliente_id, estado, stripe_payment_intent_id")
      .eq("id", trayectoId)
      .single();

    if (error || !trayecto) throw new Error("Trayecto no encontrado");
    if (trayecto.cliente_id !== clienteId) throw new Error("No tienes permiso sobre este trayecto");
    if (trayecto.stripe_payment_intent_id) throw new Error("Este trayecto ya tiene un pago asociado");
    if (trayecto.estado === "cancelado" || trayecto.estado === "completado") {
      throw new Error("No se puede crear un pago para un trayecto cancelado o completado");
    }

    // Creamos el PaymentIntent en Stripe.
    // capture_method: 'manual' → el dinero queda retenido pero no capturado.
    // La captura ocurre cuando el taxista marca el servicio como completado.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(trayecto.precio_cliente * 100), // Stripe trabaja en céntimos
      currency: "eur",
      capture_method: "manual",
      metadata: {
        trayecto_id: trayectoId,
        cliente_id: clienteId,
      },
    });

    // Guardamos el PaymentIntent tanto en el trayecto como en la tabla de pagos
    await Promise.all([
      admin
        .from("trayectos")
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq("id", trayectoId),

      admin.from("pagos").insert({
        cliente_id: clienteId,
        trayecto_id: trayectoId,
        stripe_payment_intent_id: paymentIntent.id,
        estado: "pendiente",
        importe_total: trayecto.precio_cliente,
        comision_plataforma: 0,  // Se actualizará cuando se negocien las tarifas (Ticket 5.3)
        importe_taxista: trayecto.precio_cliente,
      }),
    ]);

    return {
      client_secret: paymentIntent.client_secret!,
      payment_intent_id: paymentIntent.id,
    };
  }


  // ---------------------------------------------------------------------------
  // CAPTURAR PAGO Y TRANSFERIR AL TAXISTA
  // Se llama internamente cuando el trayecto pasa a estado 'completado'.
  // 1. Capturamos el PaymentIntent (el dinero sale de la tarjeta del cliente).
  // 2. Transferimos el importe del taxista a su cuenta Stripe Connect.
  // 3. Registramos todo en la BD.
  //
  // El incentivo del taxista NO se transfiere aquí: se acumula en
  // taxistas_perfil.incentivo_acumulado y el taxista lo retira cuando quiere.
  // ---------------------------------------------------------------------------
  async capturarPagoYTransferir(trayectoId: string): Promise<void> {
    const admin = this.supabaseService.admin;

    // Leemos el trayecto y el pago en paralelo
    const [{ data: trayecto }, { data: pago }] = await Promise.all([
      admin
        .from("trayectos")
        .select("taxista_titular_id, importe_taxista, stripe_payment_intent_id")
        .eq("id", trayectoId)
        .single(),
      admin
        .from("pagos")
        .select("id, stripe_payment_intent_id, estado, importe_total, importe_taxista")
        .eq("trayecto_id", trayectoId)
        .single(),
    ]);

    if (!trayecto?.stripe_payment_intent_id) throw new Error("El trayecto no tiene pago asociado");
    if (!pago) throw new Error("No se encontró el registro de pago");
    if (pago.estado === "capturado") throw new Error("El pago ya fue capturado");
    if (!trayecto.taxista_titular_id) throw new Error("El trayecto no tiene taxista titular asignado");

    // Obtenemos la cuenta Stripe del taxista
    const { data: cuentaStripe } = await admin
      .from("taxistas_stripe_cuenta")
      .select("stripe_account_id, onboarding_completo")
      .eq("taxista_id", trayecto.taxista_titular_id)
      .single();

    if (!cuentaStripe?.onboarding_completo) {
      throw new Error("El taxista no ha completado el onboarding de Stripe");
    }

    // Paso 1: Capturamos el PaymentIntent (cobra al cliente)
    const intentCapturado = await stripe.paymentIntents.capture(
      trayecto.stripe_payment_intent_id
    );

    // Paso 2: Transferimos al taxista desde el balance de la plataforma.
    // Usamos el importe_taxista (precio_cliente - comision_plataforma).
    // La comisión de ConCompas queda automáticamente en el balance de la plataforma.
    const transfer = await stripe.transfers.create({
      amount: Math.round(trayecto.importe_taxista * 100),
      currency: "eur",
      destination: cuentaStripe.stripe_account_id,
      metadata: { trayecto_id: trayectoId },
    });

    // Paso 3: Actualizamos la BD con el resultado
    await Promise.all([
      admin
        .from("pagos")
        .update({
          estado: "capturado",
          stripe_charge_id: intentCapturado.latest_charge as string,
          capturado_at: new Date().toISOString(),
          comision_plataforma: pago.importe_total - pago.importe_taxista,
        })
        .eq("id", pago.id),

      admin.from("transferencias_taxista").insert({
        taxista_id: trayecto.taxista_titular_id,
        pago_id: pago.id,
        stripe_transfer_id: transfer.id,
        estado: "completada",
        importe: trayecto.importe_taxista,
        completada_at: new Date().toISOString(),
      }),
    ]);
  }


  // ---------------------------------------------------------------------------
  // REEMBOLSAR AL CLIENTE
  // Se llama cuando el cliente cancela con derecho a devolución total o parcial.
  // Si el PaymentIntent aún no está capturado (lo más habitual al cancelar),
  // se cancela directamente sin generar cargo. Si ya estaba capturado (caso
  // excepcional), se crea un refund.
  //
  // importeParcial: si se especifica, reembolsa solo esa cantidad (en euros).
  // Si no se especifica, reembolsa el importe total.
  // ---------------------------------------------------------------------------
  async reembolsarPago(trayectoId: string, importeParcial?: number): Promise<void> {
    const admin = this.supabaseService.admin;

    const { data: pago } = await admin
      .from("pagos")
      .select("id, stripe_payment_intent_id, estado, importe_total")
      .eq("trayecto_id", trayectoId)
      .single();

    if (!pago) throw new Error("No se encontró el registro de pago para este trayecto");
    if (pago.estado === "reembolsado") throw new Error("El pago ya fue reembolsado");

    if (pago.estado === "pendiente") {
      // El PaymentIntent aún no fue capturado: lo cancelamos directamente.
      // Stripe libera la retención sin cargo para el cliente ni para nosotros.
      await stripe.paymentIntents.cancel(pago.stripe_payment_intent_id);
    } else if (pago.estado === "capturado") {
      // El pago ya fue capturado: creamos un refund explícito
      await stripe.refunds.create({
        payment_intent: pago.stripe_payment_intent_id,
        amount: importeParcial ? Math.round(importeParcial * 100) : undefined,
      });
    } else {
      throw new Error(`No se puede reembolsar un pago en estado '${pago.estado}'`);
    }

    await admin
      .from("pagos")
      .update({
        estado: "reembolsado",
        reembolsado_at: new Date().toISOString(),
      })
      .eq("id", pago.id);
  }


  // ---------------------------------------------------------------------------
  // CAPTURAR PARCIALMENTE O CANCELAR (cancelaciones de cliente, Ticket 5.2)
  // Cuando el cliente cancela con derecho a retención parcial, capturamos solo
  // el porcentaje correspondiente del PaymentIntent. Stripe libera automáticamente
  // el resto de la autorización sin necesidad de ninguna operación adicional.
  //
  // porcentaje <= 0 → cancelamos el PaymentIntent (gratis, libera la retención completa)
  // porcentaje > 0  → capturamos amount_to_capture = importe_total * porcentaje/100
  //
  // Si el trayecto no tiene pago asociado (canceló antes de pagar, o un trayecto
  // "Para Ya!" sin checkout iniciado), no hacemos nada: no hay nada que capturar.
  // ---------------------------------------------------------------------------
  async capturarParcialOCancelar(trayectoId: string, porcentaje: number): Promise<void> {
    const admin = this.supabaseService.admin;

    const { data: pago } = await admin
      .from("pagos")
      .select("id, stripe_payment_intent_id, estado, importe_total")
      .eq("trayecto_id", trayectoId)
      .single();

    if (!pago) return; // No hay pago asociado: nada que cobrar ni que liberar

    if (pago.estado !== "pendiente") {
      throw new Error(`No se puede capturar/cancelar un pago en estado '${pago.estado}'`);
    }

    if (porcentaje <= 0) {
      await stripe.paymentIntents.cancel(pago.stripe_payment_intent_id);

      await admin
        .from("pagos")
        .update({
          estado: "reembolsado",
          reembolsado_at: new Date().toISOString(),
        })
        .eq("id", pago.id);
      return;
    }

    // El importe realmente capturado se guarda en importe_capturado_real, NUNCA en
    // importe_total: esa columna conserva siempre el precio original pactado con el
    // cliente, dato necesario para resolver cualquier disputa o reclamación.
    const importeCapturado = Math.round(pago.importe_total * (porcentaje / 100) * 100) / 100;

    await stripe.paymentIntents.capture(pago.stripe_payment_intent_id, {
      amount_to_capture: Math.round(importeCapturado * 100),
    });

    await admin
      .from("pagos")
      .update({
        estado: "capturado",
        importe_capturado_real: importeCapturado,
        capturado_at: new Date().toISOString(),
      })
      .eq("id", pago.id);
  }


  // ---------------------------------------------------------------------------
  // RETIRAR INCENTIVOS
  // El taxista solicita retirar su saldo acumulado de incentivos.
  // Creamos un Transfer desde el balance de la plataforma a la cuenta Connect
  // del taxista. El taxista elige si quiere payout estándar (gratis) o
  // instantáneo (1%, mínimo 0.40€).
  //
  // Nota: Stripe Connect no permite cargar directamente al taxista, así que
  // las penalizaciones se descuentan del incentivo ANTES de transferir.
  // ---------------------------------------------------------------------------
  async retirarIncentivo(
    taxistaId: string,
    datos: RetirarIncentivoInput
  ): Promise<RetiroIncentivoRespuesta> {
    const admin = this.supabaseService.admin;

    // Leemos el perfil del taxista para saber cuánto tiene disponible
    const [{ data: perfil }, { data: cuentaStripe }] = await Promise.all([
      admin
        .from("taxistas_perfil")
        .select("incentivo_acumulado, penalizacion_pendiente")
        .eq("profile_id", taxistaId)
        .single(),
      admin
        .from("taxistas_stripe_cuenta")
        .select("stripe_account_id, onboarding_completo, payouts_habilitados")
        .eq("taxista_id", taxistaId)
        .single(),
    ]);

    if (!perfil) throw new Error("Perfil de taxista no encontrado");
    if (!cuentaStripe?.onboarding_completo) throw new Error("El taxista no ha completado el onboarding de Stripe");

    // Descontamos las penalizaciones pendientes antes de transferir
    const importeNeto = Number(perfil.incentivo_acumulado) - Number(perfil.penalizacion_pendiente);

    if (importeNeto <= 0) {
      throw new Error(
        perfil.penalizacion_pendiente > 0
          ? "No hay saldo disponible: las penalizaciones pendientes superan el incentivo acumulado"
          : "No tienes incentivos acumulados para retirar"
      );
    }

    // Para Instant Payout: Stripe cobra 1% con un mínimo de 0.40€
    const importeRecibido =
      datos.tipo_payout === "instantaneo"
        ? Math.max(importeNeto - Math.max(importeNeto * 0.01, 0.40), 0)
        : importeNeto;

    // Creamos el Transfer a la cuenta Connect del taxista
    const transfer = await stripe.transfers.create({
      amount: Math.round(importeNeto * 100),
      currency: "eur",
      destination: cuentaStripe.stripe_account_id,
      metadata: { tipo: "retiro_incentivo", taxista_id: taxistaId },
    });

    // Actualizamos el perfil del taxista y registramos el retiro en la BD
    await Promise.all([
      admin
        .from("taxistas_perfil")
        .update({
          incentivo_acumulado: 0,
          penalizacion_pendiente: 0,
        })
        .eq("profile_id", taxistaId),

      admin.from("retiros_incentivo").insert({
        taxista_id: taxistaId,
        importe_solicitado: importeNeto,
        importe_recibido: importeRecibido,
        tipo_payout: datos.tipo_payout,
        estado: "procesado",
        stripe_transfer_id: transfer.id,
      }),
    ]);

    return {
      stripe_transfer_id: transfer.id,
      importe_solicitado: importeNeto,
      importe_recibido: importeRecibido,
      tipo_payout: datos.tipo_payout,
    };
  }


  // ---------------------------------------------------------------------------
  // SINCRONIZAR CUENTA DESDE WEBHOOK
  // Llamado cuando Stripe nos avisa de que una cuenta Connect ha sido actualizada.
  // Comprobamos si el taxista completó el onboarding consultando directamente
  // a la API de Stripe (más fiable que confiar solo en los datos del evento).
  // ---------------------------------------------------------------------------
  async sincronizarCuentaDesdeWebhook(stripeAccountId: string): Promise<void> {
    const cuenta = await stripe.accounts.retrieve(stripeAccountId);

    await this.supabaseService.admin
      .from("taxistas_stripe_cuenta")
      .update({
        onboarding_completo: cuenta.charges_enabled && cuenta.details_submitted,
        payouts_habilitados: cuenta.payouts_enabled ?? false,
      })
      .eq("stripe_account_id", stripeAccountId);
  }
}
