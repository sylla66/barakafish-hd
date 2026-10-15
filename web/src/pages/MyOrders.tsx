import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import { ORDER_STATUS_LABEL, type Order } from '../types/order';

interface OrdersResponse {
  orders: Order[];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// "Mes commandes" : le meme ecran sert l'acheteur et le vendeur ; le role renvoye
// par l'API indique s'il s'agit d'un achat ou d'une vente.
export default function MyOrders() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    setIsLoading(true);
    apiRequest<OrdersResponse>('/orders')
      .then((data) => {
        if (active) setOrders(data.orders);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

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
        <h1>Mes commandes</h1>
        <p>{orders.length} commande(s).</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {orders.length === 0 ? (
        <p className="info">Vous n'avez pas encore de commande.</p>
      ) : (
        <ul className="annonces">
          {orders.map((order) => (
            <li key={order.id} className="annonce">
              <div className="annonce__corps">
                <div className="annonce__titre">
                  <strong>{order.listingTitle}</strong>
                  <span className={`statut statut--commande statut--${order.status}`}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                </div>
                <p className="annonce__meta">
                  {order.role === 'buyer' ? 'Achat' : 'Vente'} - {order.seller.shopName} -{' '}
                  {order.quantityKg} kg
                </p>
                <p className="annonce__meta">
                  Total {order.totalAmount} FCFA - {formatDate(order.createdAt)}
                </p>
                <p className="annonce__actions">
                  <Link className="bouton bouton--secondaire" to={`/commandes/${order.id}`}>
                    Voir le detail
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__lien">
        <Link to="/">Retour au catalogue</Link>
      </p>
    </main>
  );
}
