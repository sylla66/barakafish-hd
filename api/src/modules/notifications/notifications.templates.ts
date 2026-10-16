export const NOTIFICATION_TEMPLATES = {
  'order.new': 'Nouvelle commande : #{orderId}. Vendeur, connectez-vous pour expedier.',
  'order.paid': 'Paiement recu pour la commande #{orderId}. Veuillez expedier.',
  'order.shipped': 'Votre commande #{orderId} a ete expediee. Surveillez la livraison.',
  'order.delivered': 'Votre commande #{orderId} a ete livree. Veuillez confirmer la reception dans les 48h.',
  'order.release_reminder': 'Rappel : commande #{orderId}. Confirmez la reception avant liberation automatique.',
  'order.released': 'Fonds liberes pour la commande #{orderId}. Montant : {amount} FCFA.',
  'dispute.opened.seller': 'Litige ouvert sur la commande #{orderId}. Motif : {reason}.',
  'dispute.opened.admin': 'Nouveau litige (commande #{orderId}). Motif : {reason}.',
  'dispute.resolved.buyer': 'Litige resolu pour la commande #{orderId}. Decision : {decision}.',
  'dispute.resolved.seller': 'Litige resolu pour la commande #{orderId}. Decision : {decision}.',
  'seller.verified': 'Votre profil vendeur a ete verifie. Vous pouvez vendre maintenant.',
  'seller.rejected': 'Votre profil vendeur a ete rejete. Motif : {reason}.',
  'dispute.seller_suspended': 'Avertissement : trop de litiges fondes. Suspension appliquee au vendeur.',
} as const;

export type NotificationTemplateKey = keyof typeof NOTIFICATION_TEMPLATES;
