import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { StarRating } from '../components/StarRating';
import { API_BASE_URL, apiRequest, errorMessage } from '../lib/api';
import type { Review, ReviewListResponse } from '../types/review';
import type { PublicSellerProfile } from '../types/seller';

interface ProfileResponse {
  profile: PublicSellerProfile;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { dateStyle: 'long' });
}

// Fiche publique d'un vendeur : informations de la boutique, note moyenne et
// liste paginee des avis des acheteurs.
export default function SellerProfile() {
  const { id } = useParams<{ id: string }>();

  const [profile, setProfile] = useState<PublicSellerProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = useCallback(
    async (cursor: string | null): Promise<ReviewListResponse> => {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return apiRequest<ReviewListResponse>(`/sellers/${id}/reviews${query}`);
    },
    [id],
  );

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    Promise.all([apiRequest<ProfileResponse>(`/sellers/${id}`), loadReviews(null)])
      .then(([profileData, reviewData]) => {
        if (!active) return;
        setProfile(profileData.profile);
        setReviews(reviewData.reviews);
        setNextCursor(reviewData.next_cursor);
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
  }, [id, loadReviews]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await loadReviews(nextCursor);
      setReviews((previous) => [...previous, ...data.reviews]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page page--etroite">
        <p className="alerte" role="alert">
          {error ?? 'Vendeur introuvable.'}
        </p>
        <p className="page__lien">
          <Link to="/">Retour au catalogue</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__entete">
        <h1>{profile.shopName}</h1>
        <p className="fiche-vendeur__meta">
          <span>{profile.zone}</span>
          {profile.isVerified ? <span className="badge badge--verifie">Verifie</span> : null}
        </p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      <section className="commande__bloc">
        <h2>Reputation</h2>
        {profile.ratingCount > 0 ? (
          <StarRating value={profile.ratingAvg} count={profile.ratingCount} />
        ) : (
          <p className="info">Aucun avis pour le moment.</p>
        )}
        {profile.description ? <p className="avis__commentaire">{profile.description}</p> : null}
      </section>

      <section className="commande__bloc">
        <h2>Avis des acheteurs</h2>
        {reviews.length === 0 ? (
          <p className="info">Aucun avis publie.</p>
        ) : (
          <ul className="avis">
            {reviews.map((review) => (
              <li key={review.id} className="avis__item">
                <div className="avis__entete">
                  <span className="avis__auteur">{review.buyerName}</span>
                  <StarRating value={review.rating} />
                </div>
                <p className="avis__date">
                  {formatDate(review.createdAt)} - {review.listingTitle}
                </p>
                {review.comment ? <p className="avis__commentaire">{review.comment}</p> : null}
                {review.photoUrl ? (
                  <img
                    className="avis__photo"
                    src={`${API_BASE_URL}${review.photoUrl}`}
                    alt="Photo de l avis"
                    loading="lazy"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <button
            type="button"
            className="bouton bouton--secondaire"
            disabled={isLoadingMore}
            onClick={() => void loadMore()}
          >
            {isLoadingMore ? 'Chargement...' : "Voir plus d'avis"}
          </button>
        ) : null}
      </section>

      <p className="page__lien">
        <Link to="/">Retour au catalogue</Link>
      </p>
    </main>
  );
}
