import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import { PAYMENT_STATUS_LABEL, type Payment } from '../types/payment';

interface PaymentResponse {
  payment: Payment;
}

interface PayResponse {
  paymentUrl: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

// Page de retour de paiement : le fournisseur redirige ici apres le paiement.
// On interroge l'etat jusqu'a ce qu'il soit definitif (reussi, echoue...).
export default function PaymentReturn() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { reference } = useParams<{ reference: string }>();
  const navigate = useNavigate();

  const [payment, setPayment] = useState<Payment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated || !reference) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;

    const poll = async (): Promise<void> => {
      try {
        const data = await apiRequest<PaymentResponse>(`/payments/reference/${reference}`);
        if (!active) return;
        setPayment(data.payment);
        setIsLoading(false);
        if (data.payment.status === 'initiated' && tries < MAX_POLLS) {
          tries += 1;
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!active) return;
        setError(errorMessage(err));
        setIsLoading(false);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [isAuthenticated, reference]);

  // Nouvelle tentative : on relance un paiement pour la meme commande.
  async function retry(): Promise<void> {
    if (!payment) return;
    setIsRetrying(true);
    setError(null);
    try {
      const data = await apiRequest<PayResponse>(`/orders/${payment.order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      window.location.href = data.paymentUrl;
    } catch (err) {
      setError(errorMessage(err));
      setIsRetrying(false);
    }
  }

  if (isAuthLoading || isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Verification du paiement...</p>
      </main>
    );
  }

  if (!payment) {
    return (
      <main className="page page--etroite">
        <p className="alerte" role="alert">
          {error ?? 'Paiement introuvable.'}
        </p>
        <p className="page__lien">
          <Link to="/commandes">Mes commandes</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>Paiement</h1>
        <span className={`statut statut--commande statut--${payment.status}`}>
          {PAYMENT_STATUS_LABEL[payment.status]}
        </span>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      <section className="commande__bloc paiement">
        <p className="paiement__titre">{payment.order.listingTitle}</p>
        <p className="paiement__montant">{payment.amount} FCFA</p>

        {payment.status === 'initiated' ? (
          <p className="info">Paiement en cours de traitement. Merci de patienter.</p>
        ) : null}
        {payment.status === 'succeeded' ? (
          <p className="info">Votre paiement a bien ete recu. Les fonds sont conserves jusqu'a la reception.</p>
        ) : null}
        {payment.status === 'failed' ? (
          <p className="alerte" role="alert">
            Le paiement n'a pas abouti. Vous pouvez reessayer.
          </p>
        ) : null}
        {payment.status === 'refunded' ? (
          <p className="info">Cette commande a ete remboursee ({payment.refundedAmount} FCFA).</p>
        ) : null}

        <div className="commande__actions">
          <Link className="bouton" to={`/commandes/${payment.order.id}`}>
            Voir la commande
          </Link>
          {payment.status === 'failed' ? (
            <button type="button" className="bouton" disabled={isRetrying} onClick={() => void retry()}>
              {isRetrying ? 'Redirection...' : 'Reessayer le paiement'}
            </button>
          ) : null}
        </div>
      </section>

      <p className="page__lien">
        <Link to="/commandes">Mes commandes</Link>
      </p>
    </main>
  );
}
