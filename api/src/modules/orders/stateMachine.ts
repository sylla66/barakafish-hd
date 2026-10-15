// Machine a etats des commandes (AGENTS.md, regle 1 et 2). C'est la SEULE source
// de verite des transitions autorisees et des acteurs qui peuvent les declencher.
// Aucun autre code de l'application ne doit modifier orders.status : tout passe
// par transitionOrder() dans orders.service.ts.

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

// Qui a le droit de declencher une transition. 'system' designe les traitements
// automatiques (webhooks de paiement, tache planifiee).
export type ActorKind = 'buyer' | 'seller' | 'admin' | 'system';

export interface TransitionRule {
  to: OrderStatus;
  actors: ActorKind[];
}

export const TRANSITIONS: Record<OrderStatus, TransitionRule[]> = {
  pending_payment: [
    { to: 'paid', actors: ['system'] },
    { to: 'cancelled', actors: ['buyer', 'system'] },
  ],
  paid: [
    { to: 'shipped', actors: ['seller'] },
    { to: 'refunded', actors: ['admin'] },
    { to: 'cancelled', actors: ['buyer'] },
  ],
  shipped: [
    { to: 'delivered', actors: ['seller'] },
    { to: 'disputed', actors: ['buyer'] },
  ],
  delivered: [
    { to: 'confirmed', actors: ['buyer'] },
    { to: 'disputed', actors: ['buyer'] },
    { to: 'released', actors: ['system'] },
  ],
  confirmed: [{ to: 'released', actors: ['system'] }],
  disputed: [
    { to: 'refunded', actors: ['admin'] },
    { to: 'released', actors: ['admin'] },
  ],
  released: [],
  refunded: [],
  cancelled: [],
};

export const OPEN_STATUSES: OrderStatus[] = [
  'pending_payment',
  'paid',
  'shipped',
  'delivered',
  'confirmed',
  'disputed',
];

export function allowedTransitions(status: OrderStatus): OrderStatus[] {
  return TRANSITIONS[status].map((rule) => rule.to);
}

// Verifie qu'une transition existe et que l'acteur y est autorise.
export function canTransition(from: OrderStatus, to: OrderStatus, actor: ActorKind): boolean {
  const rule = TRANSITIONS[from].find((candidate) => candidate.to === to);
  return rule !== undefined && rule.actors.includes(actor);
}

// Indique si la transition existe (independamment de l'acteur) : permet de
// distinguer "transition interdite" (409) de "droits insuffisants" (403).
export function isKnownTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].some((rule) => rule.to === to);
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
