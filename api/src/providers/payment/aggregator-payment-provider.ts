import { AppError } from '../../lib/AppError';
import type {
  InitiatePaymentResult,
  PaymentBuyer,
  PaymentEvent,
  PaymentOrder,
  PaymentProvider,
  PayoutSeller,
} from './payment-provider';

// SQUELETTE : a completer avec l'agregateur retenu (PAYMENT_PROVIDER=aggregator).
// Les fournisseurs envisages exposent tous la meme gymnastique :
//
//   1. initiatePayment : POST sur l'API d'initiation (ex. PayDunya
//      /api/v1/checkout, PayTech /api/payment, CinetPay /v2/payment) avec le
//      montant en FCFA, un identifiant de commande unique et l'URL de retour.
//      La reponse contient l'identifiant de transaction (providerReference) et
//      l'URL de paiement mobile (Wave / Orange Money) a renvoyer au payer.
//
//   2. verifyWebhook : chaque fournisseur signe differemment son webhook.
//      - PayDunya : en-tete x-signature (HMAC-SHA256 du corps brut) ou
//        x-checkout-token selon le mode ;
//      - PayTech : en-tete x-signature = SHA256(secret + corps) ;
//      - CinetPay : en-tete x-token + controle de request_id.
//      Dans TOUS les cas : lire le corps BRUT (express.raw, jamais express.json),
//      recalculer la signature, comparer en temps constant, puis traduire le
//      payload en PaymentEvent (provider_reference, status, amount en FCFA).
//
//   3. refund : appel API de remboursement (total ou partiel) du fournisseur.
//
//   4. payout : versement au vendeur (wave:direct/Orange Money), appele
//      UNIQUEMENT apres liberation du sequestre (AGENTS.md, regle 3).
//
// Tant que chaque methode n'est pas implementee, elle leve une erreur explicite
// : aucune fausse reussite silencieuse.
export class AggregatorPaymentProvider implements PaymentProvider {
  readonly name = 'aggregator';

  async initiatePayment(_order: PaymentOrder, _buyer: PaymentBuyer): Promise<InitiatePaymentResult> {
    // TODO(fournisseur) : POST vers l'API d'initiation puis
    // return { redirectUrl: data.payment_url, providerReference: data.transaction_id }.
    throw AppError.notFound(
      "Le fournisseur de paiement n'est pas encore configure (PAYMENT_PROVIDER=aggregator).",
    );
  }

  verifyWebhook(_headers: { [key: string]: string | string[] | undefined }, _body: Buffer | string): PaymentEvent {
    // TODO(fournisseur) : verifier la signature du fournisseur sur le corps brut,
    // puis renvoyer l'evenement normalise.
    throw AppError.notFound(
      "Le fournisseur de paiement n'est pas encore configure (PAYMENT_PROVIDER=aggregator).",
    );
  }

  async refund(_paymentId: string, _amount: number): Promise<{ refunded: boolean; amount: number }> {
    // TODO(fournisseur) : appel API de remboursement.
    throw AppError.notFound(
      "Le fournisseur de paiement n'est pas encore configure (PAYMENT_PROVIDER=aggregator).",
    );
  }

  async payout(_seller: PayoutSeller, _amount: number, _reference: string): Promise<{ sent: boolean }> {
    // TODO(fournisseur) : versement mobile au vendeur.
    throw AppError.notFound(
      "Le fournisseur de paiement n'est pas encore configure (PAYMENT_PROVIDER=aggregator).",
    );
  }
}
