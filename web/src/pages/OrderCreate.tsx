import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { API_BASE_URL, apiRequest, errorMessage } from '../lib/api';
import { STATE_LABEL, type Listing } from '../types/listing';
import type { Order } from '../types/order';

interface ListingResponse {
  listing: Listing;
}

interface OrderResponse {
  order: Order;
}

// Ecran de commande : on part d'une annonce et on saisit la quantite, l'adresse
// et la zone de livraison. Le prix est celui de l'annonce, fige a la commande.
export default function OrderCreate() {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();

  const [listing, setListing] = useState<Listing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quantity, setQuantity] = useState('');
  const [address, setAddress] = useState('');
  const [zone, setZone] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    apiRequest<ListingResponse>(`/listings/${listingId}`)
      .then((data) => {
        if (!active) return;
        setListing(data.listing);
        setQuantity(String(data.listing.minOrderKg));
        setZone(data.listing.zone);
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
  }, [listingId]);

  const quantityNumber = Number(quantity);
  const subtotal =
    listing && Number.isFinite(quantityNumber) && quantityNumber > 0
      ? Math.round(quantityNumber * listing.pricePerKg)
      : 0;

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const data = await apiRequest<OrderResponse>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          listing_id: listingId,
          quantity_kg: quantityNumber,
          delivery_address: address.trim(),
          delivery_zone: zone.trim(),
        }),
      });
      navigate(`/commandes/${data.order.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setIsSubmitting(false);
    }
  }

  if (isAuthLoading || isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  if (!listing) {
    return (
      <main className="page page--etroite">
        <p className="alerte" role="alert">
          {error ?? 'Annonce introuvable.'}
        </p>
        <p className="page__lien">
          <Link to="/">Retour au catalogue</Link>
        </p>
      </main>
    );
  }

  const isOwnListing = user?.id === listing.sellerId;

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>Commander</h1>
        <p>
          {listing.title} - {listing.speciesNameFr}
        </p>
      </header>

      <section className="carte">
        {listing.photos[0] ? (
          <img
            className="carte__photo"
            src={`${API_BASE_URL}${listing.photos[0].url}`}
            alt={listing.title}
          />
        ) : (
          <div className="carte__photo carte__photo--vide">Sans photo</div>
        )}
        <div className="carte__corps">
          <p className="carte__prix">{listing.pricePerKg} FCFA/kg</p>
          <p className="carte__meta">
            {STATE_LABEL[listing.state]} - {listing.zone}
          </p>
          <p className="carte__meta">
            {listing.quantityKg} kg dispo - minimum {listing.minOrderKg} kg
          </p>
          <p className="carte__vendeur">
            <span>{listing.seller.shopName}</span>
            {listing.seller.isVerified ? <span className="badge badge--verifie">Verifie</span> : null}
          </p>
        </div>
      </section>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {isOwnListing ? (
        <p className="info">Vous ne pouvez pas commander votre propre annonce.</p>
      ) : (
        <form className="formulaire" onSubmit={onSubmit}>
          <label className="champ">
            <span>Quantite (kg)</span>
            <input
              type="number"
              min={listing.minOrderKg}
              max={listing.quantityKg}
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
            <small>
              Entre {listing.minOrderKg} kg et {listing.quantityKg} kg.
            </small>
          </label>

          <label className="champ">
            <span>Adresse de livraison</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rue, quartier, repere..."
              required
            />
          </label>

          <label className="champ">
            <span>Zone de livraison</span>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Dakar, Mbour..."
              required
            />
          </label>

          <p className="commande__total">
            Total estime : <strong>{subtotal} FCFA</strong>
            <small> (frais de livraison calcules a l'etape suivante)</small>
          </p>

          <button type="submit" className="bouton" disabled={isSubmitting}>
            {isSubmitting ? 'Envoi...' : 'Valider la commande'}
          </button>
        </form>
      )}

      <p className="page__lien">
        <Link to="/">Retour au catalogue</Link>
      </p>
    </main>
  );
}
