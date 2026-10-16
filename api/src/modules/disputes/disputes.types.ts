import type { Order, OrderHistoryEntry } from '../orders/orders.types';

// Motif d'ouverture d'un litige (etape 9). La liste est fixe et fermee.
export const DISPUTE_REASONS = [
  'produit_non_conforme',
  'produit_avarie',
  'quantite_incorrecte',
  'retard',
  'autre',
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number];

// Statut de resolution (alignes sur l'enum PostgreSQL dispute_status).
export const DISPUTE_STATUSES = [
  'open',
  'under_review',
  'resolved_refund',
  'resolved_partial',
  'resolved_release',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

// Decision rendue par l'admin.
export type DisputeDecision = 'refund' | 'partial' | 'release';

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  produit_non_conforme: 'Produit non conforme',
  produit_avarie: 'Produit avarie',
  quantite_incorrecte: 'Quantite incorrecte',
  retard: 'Retard de livraison',
  autre: 'Autre motif',
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Ouvert',
  under_review: 'En cours d\'examen',
  resolved_refund: 'Rembourse (total)',
  resolved_partial: 'Rembourse (partiel)',
  resolved_release: 'Libere au vendeur',
};

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  authorId: string;
  authorName: string;
  authorRole: 'buyer' | 'seller';
  photoUrl: string | null;
  message: string | null;
  createdAt: string;
}

export interface Dispute {
  id: string;
  orderId: string;
  openedBy: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  refundAmount: number | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  evidence: DisputeEvidence[];
}

export interface AdminDisputeListItem {
  id: string;
  orderId: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  refundAmount: number | null;
  createdAt: string;
  resolvedAt: string | null;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerShopName: string;
  orderStatus: Order['status'];
  orderTotalAmount: number;
}

export interface SellerDisputeHistoryEntry {
  id: string;
  orderId: string;
  reason: DisputeReason;
  status: DisputeStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SellerDisputeHistory {
  sellerId: string;
  shopName: string;
  ratingAvg: number;
  ratingCount: number;
  // Litiges fondes (resolution en faveur de l'acheteur) : total et fenetre glissante.
  foundedTotal: number;
  foundedInWindow: number;
  windowDays: number;
  recent: SellerDisputeHistoryEntry[];
}

export interface AdminDisputeDetail {
  dispute: Dispute;
  order: Order;
  orderHistory: OrderHistoryEntry[];
  sellerHistory: SellerDisputeHistory;
}
