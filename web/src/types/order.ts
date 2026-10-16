export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'confirmed'
  | 'released'
  | 'disputed'
  | 'refunded'
  | 'cancelled';

export interface OrderHistoryEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderSellerInfo {
  userId: string;
  shopName: string;
  isVerified: boolean;
}

export interface Order {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  listingTitle: string;
  speciesNameFr: string;
  quantityKg: number;
  unitPrice: number;
  subtotal: number;
  deliveryFee: number;
  commissionRateBps: number;
  commissionAmount: number;
  totalAmount: number;
  sellerPayout: number;
  status: OrderStatus;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  deliveredAt: string | null;
  autoReleaseAt: string | null;
  buyerConfirmedAt: string | null;
  releasedAt: string | null;
  receiptPhotoUrl: string | null;
  seller: OrderSellerInfo;
  role: 'buyer' | 'seller' | 'admin';
  history: OrderHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'En attente de paiement',
  paid: 'Payee',
  shipped: 'Expediee',
  delivered: 'Livree',
  confirmed: 'Confirmee',
  released: 'Fonds liberes',
  disputed: 'En litige',
  refunded: 'Remboursee',
  cancelled: 'Annulee',
};
