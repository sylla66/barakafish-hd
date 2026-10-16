import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  type AdminDisputeListItem,
  type DisputeStatus,
} from '../types/dispute';
import { ORDER_STATUS_LABEL } from '../types/order';

interface ListResponse {
  disputes: AdminDisputeListItem[];
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_FILTERS: DisputeStatus[] = [
  'open',
  'under_review',
  'resolved_refund',
  'resolved_partial',
  'resolved_release',
];

// Back-office : liste des litiges, filtrable par statut.
export default function AdminDisputes() {
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [disputes, setDisputes] = useState<AdminDisputeListItem[]>([]);
  const [status, setStatus] = useState<DisputeStatus | ''>('');
  const [isLoading, setIsLoading] = useState(true);
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
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await apiRequest<ListResponse>(`/admin/disputes${query}`);
      setDisputes(data.disputes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (user && !user.isAdmin) {
      setError('Acces reserve aux administrateurs.');
      setIsLoading(false);
      return;
    }
    void load();
  }, [isAuthenticated, user, load]);

  if (isAuthLoading || isLoading) {
    return (
      <main className="page">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__entete">
        <h1>Litiges</h1>
        <p>{disputes.length} litige(s).</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      <label className="champ">
        <span>Filtrer par statut</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as DisputeStatus | '')}>
          <option value="">Tous</option>
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {DISPUTE_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>

      {disputes.length === 0 ? (
        <p className="info">Aucun litige.</p>
      ) : (
        <ul className="annonces">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="annonce">
              <div className="annonce__corps">
                <div className="annonce__titre">
                  <strong>{DISPUTE_REASON_LABEL[dispute.reason]}</strong>
                  <span className={`statut statut--litige statut--${dispute.status}`}>
                    {DISPUTE_STATUS_LABEL[dispute.status]}
                  </span>
                </div>
                <p className="annonce__meta">
                  Acheteur : {dispute.buyerName} - Vendeur : {dispute.sellerShopName}
                </p>
                <p className="annonce__meta">
                  Commande {ORDER_STATUS_LABEL[dispute.orderStatus]} - total{' '}
                  {dispute.orderTotalAmount} FCFA
                </p>
                <p className="annonce__meta">Ouvert le {formatDate(dispute.createdAt)}</p>
                {dispute.refundAmount !== null ? (
                  <p className="annonce__meta">Rembourse : {dispute.refundAmount} FCFA</p>
                ) : null}
                <p className="annonce__actions">
                  <Link className="bouton bouton--secondaire" to={`/admin/litiges/${dispute.id}`}>
                    Traiter le litige
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__lien">
        <Link to="/">Retour a l'accueil</Link>
      </p>
    </main>
  );
}
