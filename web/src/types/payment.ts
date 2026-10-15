import type { OrderStatus } from './order';

export type PaymentStatus = 'initiated' | 'succeeded' | 'failed' | 'refunded';

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
  order: {
    id: string;
    status: OrderStatus;
    totalAmount: number;
    listingTitle: string;
  };
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  initiated: 'En cours',
  succeeded: 'Paiement reussi',
  failed: 'Paiement echoue',
  refunded: 'Rembourse',
};
