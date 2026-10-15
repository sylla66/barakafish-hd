import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import { ORDER_STATUS_LABEL, type Order } from '../types/order';

interface OrderResponse {
  order: Order;
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

  const canShip = order.role === 'seller' && order.status === 'paid';
  const canDeliver = order.role === 'seller' && order.status === 'shipped';
  const canCancel = order.role === 'buyer' && (order.status === 'pending_payment' || order.status === 'paid');

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
        <p className="annonce__meta">Vendeur : {order.seller.shopName}</p>
        <p className="annonce__meta">Adresse : {order.deliveryAddress ?? '-'}</p>
        <p className="annonce__meta">Zone : {order.deliveryZone ?? '-'}</p>
        {order.autoReleaseAt ? (
          <p className="annonce__meta">Liberation automatique : {formatDate(order.autoReleaseAt)}</p>
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

      {canShip || canDeliver || canCancel ? (
        <div className="commande__actions">
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
