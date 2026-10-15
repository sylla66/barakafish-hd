import type { OrderStatus } from './stateMachine';

export type { OrderStatus } from './stateMachine';

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
  // Role de la personne qui consulte la commande (pour l'affichage cote web).
  role: 'buyer' | 'seller' | 'admin';
  history: OrderHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// Acteur d'une transition. 'system' = traitement automatique (scheduler, webhook).
export type TransitionActor =
  | { kind: 'system' }
  | { kind: 'user'; id: string; isAdmin: boolean; isSeller: boolean; isBuyer: boolean };
