import type { Order, OrderStatus } from './orders.types';

// Points d'extension executes APRES la validation d'une transition (donc apres
// le COMMIT). C'est le seul endroit ou un module externe (paiements, futur
// module de notifications) peut reagir a un changement d'etat sans violer la
// regle 1 : orders n'importe jamais paiements, paiements s'enregistre ici.

export interface OrderTransitionEvent {
  order: Order;
  from: OrderStatus;
  to: OrderStatus;
  note: string | null;
}

export type OrderTransitionHook = (event: OrderTransitionEvent) => void | Promise<void>;

const hooks: OrderTransitionHook[] = [];

export function onOrderTransition(hook: OrderTransitionHook): void {
  hooks.push(hook);
}

// Un hook qui echoue ne peut pas faire echouer la transition : la commande a
// deja change d'etat de facon coherente. L'erreur est journalisee pour permettre
// une reprise manuelle (ex. nouvel essai de versement depuis le back-office).
export async function runOrderTransitionHooks(event: OrderTransitionEvent): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(event);
    } catch (error) {
      console.error(
        '[orders] echec du hook de transition vers',
        event.to,
        'pour la commande',
        event.order.id,
        error,
      );
    }
  }
}
