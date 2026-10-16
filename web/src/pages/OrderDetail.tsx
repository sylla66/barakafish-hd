import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ProtectedImage } from '../components/ProtectedImage';
import { StarRating, StarRatingInput } from '../components/StarRating';
import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import { compressImage } from '../lib/image';
import {
  DISPUTE_REASONS,
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type Dispute,
  type DisputeEvidence,
  type DisputeReason,
} from '../types/dispute';
import { ORDER_STATUS_LABEL, type Order } from '../types/order';
import type { Review } from '../types/review';

interface OrderResponse {
  order: Order;
}

interface ReviewResponse {
  review: Review;
}

interface DisputeResponse {
  dispute: Dispute;
}

interface EvidenceResponse {
  evidence: DisputeEvidence;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// Detail d'une commande : montants figes, informations de livraison, historique
// des transitions et actions autorisees selon le role et le statut.
export default function OrderDetail() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewPhoto, setReviewPhoto] = useState<File | null>(null);
  const [submittedReview, setSubmittedReview] = useState<Review | null>(null);

  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>('produit_non_conforme');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeFile, setDisputeFile] = useState<File | null>(null);
  const [evidenceMessage, setEvidenceMessage] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<OrderResponse>(`/orders/${id}`);
      setOrder(data.order);
      // Un litige existe peut-etre : on tente de le charger pour afficher le fil
      // de preuves. L'absence de litige (404) est normale, on l'ignore.
      if (
        data.order.status === 'disputed' ||
        data.order.status === 'refunded' ||
        data.order.status === 'released'
      ) {
        try {
          const disputeData = await apiRequest<DisputeResponse>(`/orders/${id}/dispute`);
          setDispute(disputeData.dispute);
        } catch {
          setDispute(null);
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isAuthenticated) {
      void load();
    }
  }, [isAuthenticated, load]);

  async function runAction(action: 'ship' | 'deliver' | 'cancel'): Promise<void> {
    if (action === 'cancel' && !window.confirm('Annuler cette commande ?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<OrderResponse>(`/orders/${id}/${action}`, { method: 'POST' });
      setOrder(data.order);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Redirection vers la page de paiement du fournisseur (sequestre).
  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ paymentUrl: string }>(`/orders/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      window.location.href = data.paymentUrl;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  // Confirmation de reception par l'acheteur, avec photo optionnelle. Libere les
  // fonds au vendeur (statut 'released').
  async function confirmReceipt(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (receiptFile) {
        form.append('photo', await compressImage(receiptFile));
      }
      const data = await apiRequest<OrderResponse>(`/orders/${id}/confirm-receipt`, {
        method: 'POST',
        body: form,
      });
      setOrder(data.order);
      setReceiptFile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Avis de l'acheteur : note de 1 a 5, commentaire et photo optionnels.
  async function submitReview(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (rating < 1) {
      setError('Choisissez une note de 1 a 5.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('rating', String(rating));
      if (comment.trim()) {
        form.append('comment', comment.trim());
      }
      if (reviewPhoto) {
        form.append('photo', await compressImage(reviewPhoto));
      }
      const data = await apiRequest<ReviewResponse>(`/orders/${id}/review`, { method: 'POST', body: form });
      setSubmittedReview(data.review);
      setRating(0);
      setComment('');
      setReviewPhoto(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Ouverture d'un litige par l'acheteur : motif, description et photo obligatoire.
  async function submitDispute(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!disputeFile) {
      setError('Ajoutez au moins une photo pour ouvrir un litige.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('reason', disputeReason);
      form.append('description', disputeDescription.trim());
      form.append('photo', await compressImage(disputeFile));
      const data = await apiRequest<DisputeResponse>(`/orders/${id}/dispute`, {
        method: 'POST',
        body: form,
      });
      setDispute(data.dispute);
      setDisputeDescription('');
      setDisputeFile(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Ajout d'une preuve (message et/ou photo) au fil du litige.
  async function submitEvidence(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!dispute) return;
    if (!evidenceMessage.trim() && !evidenceFile) {
      setError('Ajoutez un message ou une photo.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (evidenceMessage.trim()) {
        form.append('message', evidenceMessage.trim());
      }
      if (evidenceFile) {
        form.append('photo', await compressImage(evidenceFile));
      }
      const data = await apiRequest<EvidenceResponse>(`/disputes/${dispute.id}/evidence`, {
        method: 'POST',
        body: form,
      });
      setDispute({ ...dispute, evidence: [...dispute.evidence, data.evidence] });
      setEvidenceMessage('');
      setEvidenceFile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (isAuthLoading || isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page page--etroite">
        <p className="alerte" role="alert">
          {error ?? 'Commande introuvable.'}
        </p>
        <p className="page__lien">
          <Link to="/commandes">Mes commandes</Link>
        </p>
      </main>
    );
  }

  const canPay = order.role === 'buyer' && order.status === 'pending_payment';
  const canShip = order.role === 'seller' && order.status === 'paid';
  const canDeliver = order.role === 'seller' && order.status === 'shipped';
  const canCancel = order.role === 'buyer' && (order.status === 'pending_payment' || order.status === 'paid');
  const canConfirmReceipt = order.role === 'buyer' && order.status === 'delivered';
  const canReview =
    order.role === 'buyer' &&
    (order.status === 'confirmed' || order.status === 'released') &&
    submittedReview === null;
  const canDispute =
    order.role === 'buyer' && (order.status === 'shipped' || order.status === 'delivered');
  const canAddEvidence =
    dispute !== null && (dispute.status === 'open' || dispute.status === 'under_review');

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>{order.listingTitle}</h1>
        <span className={`statut statut--commande statut--${order.status}`}>
          {ORDER_STATUS_LABEL[order.status]}
        </span>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      <section className="commande__bloc">
        <h2>Montants</h2>
        <dl className="commande__montants">
          <div>
            <dt>Prix au kilo</dt>
            <dd>{order.unitPrice} FCFA</dd>
          </div>
          <div>
            <dt>Quantite</dt>
            <dd>{order.quantityKg} kg</dd>
          </div>
          <div>
            <dt>Sous-total</dt>
            <dd>{order.subtotal} FCFA</dd>
          </div>
          <div>
            <dt>Livraison</dt>
            <dd>{order.deliveryFee} FCFA</dd>
          </div>
          <div className="commande__montants-total">
            <dt>Total</dt>
            <dd>{order.totalAmount} FCFA</dd>
          </div>
          {order.role === 'seller' ? (
            <>
              <div>
                <dt>Commission ({(order.commissionRateBps / 100).toFixed(2)} %)</dt>
                <dd>-{order.commissionAmount} FCFA</dd>
              </div>
              <div>
                <dt>A percevoir</dt>
                <dd>{order.sellerPayout} FCFA</dd>
              </div>
            </>
          ) : null}
        </dl>
      </section>

      <section className="commande__bloc">
        <h2>Livraison</h2>
        <p className="annonce__meta">
          Vendeur : <Link to={`/vendeurs/${order.sellerId}`}>{order.seller.shopName}</Link>
        </p>
        <p className="annonce__meta">Adresse : {order.deliveryAddress ?? '-'}</p>
        <p className="annonce__meta">Zone : {order.deliveryZone ?? '-'}</p>
        {order.autoReleaseAt ? (
          <p className="annonce__meta">Liberation automatique : {formatDate(order.autoReleaseAt)}</p>
        ) : null}
        {order.receiptPhotoUrl ? (
          <ProtectedImage
            className="commande__photo"
            path={order.receiptPhotoUrl}
            alt="Photo de reception"
          />
        ) : null}
      </section>

      <section className="commande__bloc">
        <h2>Historique</h2>
        <ol className="historique">
          {order.history.map((entry) => (
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

      {canConfirmReceipt ? (
        <section className="commande__bloc">
          <h2>Confirmer la reception</h2>
          <p className="annonce__meta">
            Verifiez la marchandise recue. Confirmer la reception libere le paiement au vendeur.
          </p>
          <form className="formulaire" onSubmit={(event) => void confirmReceipt(event)}>
            <label className="champ">
              <span>Photo de reception (optionnel)</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
              />
              <small>Prenez une photo du produit recu en cas de doute.</small>
            </label>
            <button type="submit" className="bouton" disabled={busy}>
              {busy ? 'Confirmation...' : 'Confirmer la reception'}
            </button>
          </form>
        </section>
      ) : null}

      {canReview ? (
        <section className="commande__bloc">
          <h2>Laisser un avis</h2>
          <form className="formulaire" onSubmit={(event) => void submitReview(event)}>
            <div className="champ">
              <span>Note</span>
              <StarRatingInput value={rating} onChange={setRating} />
            </div>
            <label className="champ">
              <span>Commentaire (optionnel)</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Qualite du produit, respect des delais..."
              />
            </label>
            <label className="champ">
              <span>Photo (optionnel)</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setReviewPhoto(event.target.files?.[0] ?? null)}
              />
            </label>
            <button type="submit" className="bouton" disabled={busy}>
              {busy ? 'Envoi...' : "Publier l'avis"}
            </button>
          </form>
        </section>
      ) : null}

      {submittedReview ? (
        <section className="commande__bloc">
          <h2>Votre avis</h2>
          <div className="avis__entete">
            <span className="avis__auteur">{submittedReview.buyerName}</span>
            <StarRating value={submittedReview.rating} />
          </div>
          {submittedReview.comment ? (
            <p className="avis__commentaire">{submittedReview.comment}</p>
          ) : null}
        </section>
      ) : null}

      {dispute ? (
        <section className="commande__bloc">
          <h2>Litige</h2>
          <p className="annonce__meta">
            Motif : {DISPUTE_REASON_LABEL[dispute.reason]} - Statut :{' '}
            <span className={`statut statut--litige statut--${dispute.status}`}>
              {DISPUTE_STATUS_LABEL[dispute.status]}
            </span>
          </p>
          <p className="avis__commentaire">{dispute.description}</p>
          {dispute.refundAmount !== null ? (
            <p className="annonce__meta">Montant rembourse : {dispute.refundAmount} FCFA</p>
          ) : null}
          {dispute.resolutionNote ? (
            <p className="annonce__meta">Decision : {dispute.resolutionNote}</p>
          ) : null}

          <h3>Fil de preuves</h3>
          <ul className="dispute__fil">
            {dispute.evidence.map((item) => (
              <li
                key={item.id}
                className={`dispute__message dispute__message--${item.authorRole}`}
              >
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

          {canAddEvidence ? (
            <form className="formulaire" onSubmit={(event) => void submitEvidence(event)}>
              <label className="champ">
                <span>Message (optionnel)</span>
                <textarea
                  value={evidenceMessage}
                  onChange={(event) => setEvidenceMessage(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Ajoutez un commentaire a l'appui de vos preuves."
                />
              </label>
              <label className="champ">
                <span>Photo (optionnel)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button type="submit" className="bouton" disabled={busy}>
                {busy ? 'Envoi...' : 'Ajouter une preuve'}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {!dispute && canDispute ? (
        <section className="commande__bloc">
          <h2>Signaler un probleme</h2>
          <p className="annonce__meta">
            Si la marchandise recue ne correspond pas, ouvrez un litige dans les 48 h suivant la
            livraison. Une photo de preuve est obligatoire.
          </p>
          <form className="formulaire" onSubmit={(event) => void submitDispute(event)}>
            <label className="champ">
              <span>Motif</span>
              <select
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value as DisputeReason)}
              >
                {DISPUTE_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="champ">
              <span>Description</span>
              <textarea
                value={disputeDescription}
                onChange={(event) => setDisputeDescription(event.target.value)}
                rows={4}
                minLength={10}
                maxLength={2000}
                required
                placeholder="Decrivez le probleme constate (au moins 10 caracteres)."
              />
            </label>
            <label className="champ">
              <span>Photo (obligatoire)</span>
              <input
                type="file"
                accept="image/*"
                required
                onChange={(event) => setDisputeFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button type="submit" className="bouton bouton--danger" disabled={busy}>
              {busy ? 'Ouverture...' : 'Ouvrir le litige'}
            </button>
          </form>
        </section>
      ) : null}

      {canPay || canShip || canDeliver || canCancel ? (
        <div className="commande__actions">
          {canPay ? (
            <button type="button" className="bouton" disabled={busy} onClick={() => void pay()}>
              {busy ? 'Redirection...' : 'Payer'}
            </button>
          ) : null}
          {canShip ? (
            <button type="button" className="bouton" disabled={busy} onClick={() => void runAction('ship')}>
              Marquer expediee
            </button>
          ) : null}
          {canDeliver ? (
            <button type="button" className="bouton" disabled={busy} onClick={() => void runAction('deliver')}>
              Marquer livree
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              className="bouton bouton--danger"
              disabled={busy}
              onClick={() => void runAction('cancel')}
            >
              Annuler la commande
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="page__lien">
        <Link to="/commandes">Mes commandes</Link>
      </p>
    </main>
  );
}
