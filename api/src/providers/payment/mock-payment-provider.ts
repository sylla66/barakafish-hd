import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import type {
  InitiatePaymentResult,
  PaymentBuyer,
  PaymentEvent,
  PaymentEventStatus,
  PaymentOrder,
  PaymentProvider,
  PayoutSeller,
} from './payment-provider';

// Fournisseur de development et de test : aucune mouvement d'argent reel.
// Le payer est redirige vers une page de simulation de l'API qui se charge
// d'envoyer un webhook (succes ou echec) signe comme le ferait un vrai
// agregateur.
export const mockPaymentControl = {
  // Permet aux tests de simuler un echec du versement au vendeur.
  failPayout: false,
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sameSignature(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async initiatePayment(order: PaymentOrder, _buyer: PaymentBuyer): Promise<InitiatePaymentResult> {
    const providerReference = randomUUID();
    const baseUrl = env.PUBLIC_API_URL.replace(/\/+$/, '');
    console.log(`[mock-payment] initiation du paiement de la commande ${order.id} (${order.totalAmount} FCFA)`);
    return {
      redirectUrl: `${baseUrl}/payments/mock/${providerReference}`,
      providerReference,
    };
  }

  // Signature HMAC-SHA256 du corps brut, placee dans l'en-tete x-signature.
  verifyWebhook(headers: { [key: string]: string | string[] | undefined }, body: Buffer | string): PaymentEvent {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const received = firstHeader(headers['x-signature']);
    const expected = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex');

    if (!received || !sameSignature(received, expected)) {
      throw AppError.unauthorized('Signature de webhook invalide.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw AppError.badRequest('Corps de webhook invalide.');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw AppError.badRequest('Corps de webhook invalide.');
    }

    const payload = parsed as Record<string, unknown>;
    if (typeof payload.provider_reference !== 'string' || payload.provider_reference.length === 0) {
      throw AppError.badRequest('Reference de paiement manquante.');
    }
    if (payload.status !== 'succeeded' && payload.status !== 'failed') {
      throw AppError.badRequest('Statut de paiement invalide.');
    }
    if (typeof payload.amount !== 'number' || !Number.isInteger(payload.amount)) {
      throw AppError.badRequest('Montant de paiement invalide.');
    }

    return {
      provider: this.name,
      providerReference: payload.provider_reference,
      status: payload.status as PaymentEventStatus,
      amount: payload.amount,
      rawPayload: parsed,
    };
  }

  async refund(paymentId: string, amount: number): Promise<{ refunded: boolean; amount: number }> {
    console.log(`[mock-payment] remboursement ${paymentId} : ${amount} FCFA`);
    return { refunded: amount > 0, amount };
  }

  async payout(seller: PayoutSeller, amount: number, reference: string): Promise<{ sent: boolean }> {
    if (mockPaymentControl.failPayout) {
      console.log(`[mock-payment] versement ${reference} refuse (simulation d echec)`);
      return { sent: false };
    }
    console.log(`[mock-payment] versement ${reference} : ${seller.shopName} - ${amount} FCFA`);
    return { sent: true };
  }
}
