import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ProtectedImage } from '../components/ProtectedImage';
import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type AdminDisputeDetail,
  type DisputeDecision,
} from '../types/dispute';
import { ORDER_STATUS_LABEL } from '../types/order';

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// Back-office : detail d'un litige et decision admin (remboursement total,
// partiel ou liberation des fonds au vendeur).
export default function AdminDisputeDetailPage() {
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AdminDisputeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [decision, setDecision] = useState<DisputeDecision>('release');
  const [refundAmount, setRefundAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<AdminDisputeDetail>(`/admin/disputes/${id}`);
      setDetail(data);
      if (data.dispute.refundAmount !== null) {
        setRefundAmount(String(data.dispute.refundAmount));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (user && !user.isAdmin) {
      setError('Acces reserve aux administrateurs.');
      setIsLoading(false);
      return;
    }
    void load();
  }, [isAuthenticated, user, load]);

  async function submitDecision(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const body: { decision: DisputeDecision; refund_amount?: number; note?: string } = { decision };
    if (decision === 'partial') {
      const amount = Number(refundAmount);
      if (!Number.isInteger(amount) || amount <= 0) {
        setError('Saisissez un montant de remboursement valide (entier positif).');
        return;
      }
      body.refund_amount = amount;
    }
    if (note.trim()) {
      body.note = note.trim();
    }

    setBusy(true);
    try {
      const data = await apiRequest<AdminDisputeDetail>(`/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDetail(data);
      setSuccess('Decision enregistree.');
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (isAuthLoading || isLoading) {
    return (
      <main className="page">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="page">
        <p className="alerte" role="alert">
          {error ?? 'Litige introuvable.'}
        </p>
        <p className="page__lien">
          <Link to="/admin/litiges">Retour aux litiges</Link>
        </p>
      </main>
    );
  }

  const { dispute, order, orderHistory, sellerHistory } = detail;
  const canResolve = dispute.status === 'open' || dispute.status === 'under_review';

  return (
    <main className="page">
      <header className="page__entete">
        <h1>Litige - {DISPUTE_REASON_LABEL[dispute.reason]}</h1>
        <span className={`statut statut--litige statut--${dispute.status}`}>
          {DISPUTE_STATUS_LABEL[dispute.status]}
        </span>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="succes">{success}</p> : null}

      <section className="commande__bloc">
        <h2>Demande</h2>
        <p className="avis__commentaire">{dispute.description}</p>
        <p className="annonce__meta">Ouvert le {formatDate(dispute.createdAt)}</p>
        {dispute.refundAmount !== null ? (
          <p className="annonce__meta">Montant rembourse : {dispute.refundAmount} FCFA</p>
        ) : null}
        {dispute.resolutionNote ? (
          <p className="annonce__meta">Decision : {dispute.resolutionNote}</p>
        ) : null}
      </section>

      <section className="commande__bloc">
        <h2>Commande</h2>
        <p className="annonce__meta">
          {order.listingTitle} -{' '}
          <span className={`statut statut--commande statut--${order.status}`}>
            {ORDER_STATUS_LABEL[order.status]}
          </span>
        </p>
        <p className="annonce__meta">Quantite : {order.quantityKg} kg</p>
        <p className="annonce__meta">
          Total : {order.totalAmount} FCFA (commission {order.commissionAmount} FCFA, vendeur{' '}
          {order.sellerPayout} FCFA)
        </p>
        <p className="annonce__meta">
          Acheteur : {order.buyerId} - Vendeur :{' '}
          <Link to={`/vendeurs/${order.sellerId}`}>{order.seller.shopName}</Link>
        </p>
      </section>

      <section className="commande__bloc">
        <h2>Historique vendeur</h2>
        <p className="annonce__meta">
          {sellerHistory.shopName} - note {sellerHistory.ratingAvg.toFixed(1)} (
          {sellerHistory.ratingCount} avis)
        </p>
        <p className="annonce__meta">
          Litiges fondes : {sellerHistory.foundedTotal} au total, {sellerHistory.foundedInWindow} sur
          les {sellerHistory.windowDays} derniers jours.
        </p>
        {sellerHistory.recent.length > 0 ? (
          <ul className="historique">
            {sellerHistory.recent.map((entry) => (
              <li key={entry.id} className="historique__etape">
                <div>
                  <p className="historique__statut">
                    {DISPUTE_REASON_LABEL[entry.reason]} - {DISPUTE_STATUS_LABEL[entry.status]}
                  </p>
                  <p className="historique__meta">
                    Commande {entry.orderId} - {formatDate(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="info">Aucun litige anterieur.</p>
        )}
      </section>

      <section className="commande__bloc">
        <h2>Fil de preuves</h2>
        <ul className="dispute__fil">
          {dispute.evidence.map((item) => (
            <li key={item.id} className={`dispute__message dispute__message--${item.authorRole}`}>
              <div className="avis__entete">
                <span className="avis__auteur">{item.authorName}</span>
                <span className="dispute__role">
                  {item.authorRole === 'seller' ? 'Vendeur' : 'Acheteur'}
                </span>
              </div>
              <p className="avis__date">{formatDate(item.createdAt)}</p>
              {item.message ? <p className="avis__commentaire">{item.message}</p> : null}
              {item.photoUrl ? (
                <ProtectedImage className="dispute__photo" path={item.photoUrl} alt="Preuve" />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="commande__bloc">
        <h2>Historique de la commande</h2>
        <ol className="historique">
          {orderHistory.map((entry) => (
            <li key={entry.id} className="historique__etape">
              <span className={`historique__point statut--${entry.toStatus}`} />
              <div>
                <p className="historique__statut">
                  {entry.fromStatus
                    ? `${ORDER_STATUS_LABEL[entry.fromStatus]} > ${ORDER_STATUS_LABEL[entry.toStatus]}`
                    : ORDER_STATUS_LABEL[entry.toStatus]}
                </p>
                <p className="historique__meta">{formatDate(entry.createdAt)}</p>
                {entry.note ? <p className="historique__note">{entry.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {canResolve ? (
        <section className="commande__bloc">
          <h2>Decision</h2>
          <form className="formulaire" onSubmit={(event) => void submitDecision(event)}>
            <label className="champ">
              <span>Decision</span>
              <select
                value={decision}
                onChange={(event) => setDecision(event.target.value as DisputeDecision)}
              >
                <option value="refund">Remboursement total a l'acheteur</option>
                <option value="partial">Remboursement partiel a l'acheteur</option>
                <option value="release">Liberation des fonds au vendeur</option>
              </select>
            </label>

            {decision === 'partial' ? (
              <label className="champ">
                <span>Montant a rembourser (FCFA)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  required
                />
                <small>Maximum : {order.totalAmount} FCFA.</small>
              </label>
            ) : null}

            <label className="champ">
              <span>Note de decision (optionnel)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
              />
            </label>

            <button type="submit" className="bouton" disabled={busy}>
              {busy ? 'Enregistrement...' : 'Valider la decision'}
            </button>
          </form>
        </section>
      ) : null}

      <p className="page__lien">
        <Link to="/admin/litiges">Retour aux litiges</Link>
      </p>
    </main>
  );
}
