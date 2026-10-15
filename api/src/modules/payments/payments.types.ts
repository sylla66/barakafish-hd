import type { OrderStatus } from '../orders/stateMachine';

export type PaymentStatus = 'initiated' | 'succeeded' | 'failed' | 'refunded';
export type PayoutStatus = 'pending' | 'sent' | 'failed';

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  providerReference: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
  refundedAmount: number;
  createdAt: string;
}

// Paiement lu avec sa commande : utilise par la page de retour de paiement.
export interface PaymentWithOrder extends Payment {
  order: {
    id: string;
    status: OrderStatus;
    totalAmount: number;
    listingTitle: string;
  };
}

export interface Payout {
  id: string;
  orderId: string;
  sellerId: string;
  amount: number;
  providerReference: string | null;
  status: PayoutStatus;
  sentAt: string | null;
  createdAt: string;
}

export type PaymentEventOutcome = 'succeeded' | 'failed' | 'ignored';
