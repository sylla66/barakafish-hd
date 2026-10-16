import type { Order, OrderHistoryEntry } from './order';

export type DisputeReason =
  | 'produit_non_conforme'
  | 'produit_avarie'
  | 'quantite_incorrecte'
  | 'retard'
  | 'autre';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_refund'
  | 'resolved_partial'
  | 'resolved_release';

export type DisputeDecision = 'refund' | 'partial' | 'release';

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

export const DISPUTE_REASONS: { value: DisputeReason; label: string }[] = [
  { value: 'produit_non_conforme', label: 'Produit non conforme' },
  { value: 'produit_avarie', label: 'Produit avarie' },
  { value: 'quantite_incorrecte', label: 'Quantite incorrecte' },
  { value: 'retard', label: 'Retard de livraison' },
  { value: 'autre', label: 'Autre motif' },
];

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  produit_non_conforme: 'Produit non conforme',
  produit_avarie: 'Produit avarie',
  quantite_incorrecte: 'Quantite incorrecte',
  retard: 'Retard de livraison',
  autre: 'Autre motif',
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Ouvert',
  under_review: "En cours d'examen",
  resolved_refund: 'Rembourse (total)',
  resolved_partial: 'Rembourse (partiel)',
  resolved_release: 'Libere au vendeur',
};
