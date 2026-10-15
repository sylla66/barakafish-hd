import type { IncomingHttpHeaders } from 'node:http';

// Contrat de paiement (AGENTS.md) : l'application ne connait jamais le
// fournisseur reel. On echange avec lui via ces quatre operations, ce qui
// permet de changer d'agregateur (PayDunya, PayTech, CinetPay...) sans toucher
// aux modules orders/payments. Selectionne par PAYMENT_PROVIDER.

export interface PaymentBuyer {
  id: string;
  fullName: string | null;
  phone: string;
}

export interface PaymentOrder {
  id: string;
  totalAmount: number;
  listingTitle: string;
}

export interface InitiatePaymentResult {
  // Page ou le payer est redirige pour confirmer le paiement.
  redirectUrl: string;
  // Reference fournie par le fournisseur : cle d'idempotence des webhooks.
  providerReference: string;
}

export type PaymentEventStatus = 'succeeded' | 'failed';

// Evenement webhook normalise : quelle que soit l'implementation, le module
// payments ne voit que cette forme.
export interface PaymentEvent {
  provider: string;
  providerReference: string;
  status: PaymentEventStatus;
  // Montant exprime en FCFA, a comparer au total fige de la commande.
  amount: number;
  rawPayload: unknown;
}

export interface PayoutSeller {
  userId: string;
  shopName: string;
}

export interface PaymentProvider {
  readonly name: string;
  initiatePayment(order: PaymentOrder, buyer: PaymentBuyer): Promise<InitiatePaymentResult>;
  // Verifie la signature puis decode le corps brut du webhook.
  verifyWebhook(headers: IncomingHttpHeaders, body: Buffer | string): PaymentEvent;
  // Remboursement total ou partiel d'un paiement effectue.
  refund(paymentId: string, amount: number): Promise<{ refunded: boolean; amount: number }>;
  // Versement au vendeur, uniquement apres liberation du sequestre.
  payout(seller: PayoutSeller, amount: number, reference: string): Promise<{ sent: boolean }>;
}
