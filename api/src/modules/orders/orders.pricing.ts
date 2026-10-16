// Calcul des montants d'une commande (AGENTS.md, regle 4) : le taux de commission
// est fige au moment de la commande. Tous les montants sont des entiers FCFA.

export const DEFAULT_COMMISSION_RATE_BPS = 600; // 6 % (plan vendeur gratuit)

export interface OrderAmounts {
  subtotal: number;
  commissionRateBps: number;
  commissionAmount: number;
  totalAmount: number;
  sellerPayout: number;
}

function roundFcfa(value: number): number {
  return Math.round(value);
}

// quantite (kg, jusqu'a 2 decimales) x prix unitaire (FCFA/kg) = sous-total.
// La commission est un pourcentage en points de base (1 bps = 0,01 %).
export function computeOrderAmounts(
  quantityKg: number,
  unitPrice: number,
  deliveryFee: number,
  commissionRateBps: number,
): OrderAmounts {
  const subtotal = roundFcfa(quantityKg * unitPrice);
  const commissionAmount = roundFcfa((subtotal * commissionRateBps) / 10_000);
  const totalAmount = subtotal + deliveryFee;
  const sellerPayout = subtotal - commissionAmount;

  return { subtotal, commissionRateBps, commissionAmount, totalAmount, sellerPayout };
}
