import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { API_BASE_URL, apiRequest, errorMessage } from '../lib/api';
import { STATE_LABEL, STATUS_LABEL, type Listing } from '../types/listing';

interface ListingsResponse {
  listings: Listing[];
}

interface ListingResponse {
  listing: Listing;
}

const ARCHIVABLE: Listing['status'][] = ['draft', 'active', 'sold_out'];

// "Mes annonces" : liste des annonces du vendeur avec changement de statut
// (publier / remettre en brouillon) et archivage.
export default function MyListings() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<ListingsResponse>('/listings/mine');
      setListings(data.listings);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void load();
    }
  }, [isAuthenticated, load]);

  async function changeStatus(listing: Listing, status: 'draft' | 'active'): Promise<void> {
    setBusyId(listing.id);
    setError(null);
    try {
      await apiRequest<ListingResponse>(`/listings/${listing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function archive(listing: Listing): Promise<void> {
    if (!window.confirm(`Archiver l'annonce "${listing.title}" ?`)) {
      return;
    }
    setBusyId(listing.id);
    setError(null);
    try {
      await apiRequest<ListingResponse>(`/listings/${listing.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

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
        <h1>Mes annonces</h1>
        <p>{listings.length} annonce(s).</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {listings.length === 0 ? (
        <p className="info">Vous n'avez pas encore d'annonce.</p>
      ) : (
        <ul className="annonces">
          {listings.map((listing) => (
            <li key={listing.id} className="annonce">
              {listing.photos[0] ? (
                <img
                  className="annonce__photo"
                  src={`${API_BASE_URL}${listing.photos[0].url}`}
                  alt={listing.title}
                />
              ) : (
                <div className="annonce__photo annonce__photo--vide">Sans photo</div>
              )}

              <div className="annonce__corps">
                <div className="annonce__titre">
                  <strong>{listing.title}</strong>
                  <span className={`statut statut--${listing.status}`}>{STATUS_LABEL[listing.status]}</span>
                </div>
                <p className="annonce__meta">
                  {listing.speciesNameFr} - {STATE_LABEL[listing.state]} - {listing.zone}
                </p>
                <p className="annonce__meta">
                  {listing.pricePerKg} FCFA/kg - {listing.quantityKg} kg dispo (min {listing.minOrderKg} kg)
                </p>
                <p className="annonce__meta">
                  {listing.photos.length} photo(s) - {listing.caughtOrFrozenOn}
                </p>

                <div className="annonce__actions">
                  {listing.status === 'draft' ? (
                    <button
                      type="button"
                      className="bouton bouton--secondaire"
                      disabled={busyId === listing.id}
                      onClick={() => void changeStatus(listing, 'active')}
                    >
                      Publier
                    </button>
                  ) : null}
                  {listing.status === 'active' ? (
                    <button
                      type="button"
                      className="bouton bouton--secondaire"
                      disabled={busyId === listing.id}
                      onClick={() => void changeStatus(listing, 'draft')}
                    >
                      Mettre en brouillon
                    </button>
                  ) : null}
                  {ARCHIVABLE.includes(listing.status) ? (
                    <button
                      type="button"
                      className="bouton bouton--danger"
                      disabled={busyId === listing.id}
                      onClick={() => void archive(listing)}
                    >
                      Archiver
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__lien">
        <Link className="bouton" to="/vendeur/annonces/nouvelle">
          Nouvelle annonce
        </Link>
      </p>
      <p className="page__lien">
        <Link to="/vendeur/statut">Statut vendeur</Link>
      </p>
    </main>
  );
}
