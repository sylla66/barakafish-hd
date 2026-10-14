import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { ApiError, apiRequest, errorMessage } from '../lib/api';
import type { SellerOwnProfile, SellerStatus } from '../types/seller';

interface ProfileResponse {
  profile: SellerOwnProfile;
}

const STATUS_LABEL: Record<SellerStatus, string> = {
  pending: 'En attente de verification',
  verified: 'Verifie',
  rejected: 'Rejete',
  suspended: 'Suspendu',
};

// Page de statut du vendeur : etat de la verification et etat des documents.
export default function SellerStatusPage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<SellerOwnProfile | null>(null);
  const [hasNoProfile, setHasNoProfile] = useState(false);
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
      const data = await apiRequest<ProfileResponse>('/sellers/profile');
      setProfile(data.profile);
      setHasNoProfile(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setHasNoProfile(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void load();
    }
  }, [isAuthenticated, load]);

  if (isAuthLoading || isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page page--etroite">
        <p className="alerte" role="alert">{error}</p>
      </main>
    );
  }

  if (hasNoProfile) {
    return (
      <main className="page page--etroite">
        <header className="page__entete">
          <h1>Statut vendeur</h1>
        </header>
        <p className="info">Vous n'avez pas encore de profil vendeur.</p>
        <p className="page__lien">
          <Link className="bouton" to="/vendeur/inscription">Devenir vendeur</Link>
        </p>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>{profile.shopName}</h1>
        <p>Statut : {STATUS_LABEL[profile.status]}</p>
      </header>

      <p className={`statut statut--${profile.status}`}>{STATUS_LABEL[profile.status]}</p>

      {profile.status === 'pending' ? (
        <p className="info">Votre dossier est en cours d'examen par notre equipe.</p>
      ) : null}
      {profile.status === 'verified' ? (
        <p className="succes">Votre compte est verifie : vous pouvez publier des annonces.</p>
      ) : null}
      {profile.status === 'rejected' ? (
        <p className="alerte" role="alert">
          Motif du rejet : {profile.rejectionReason ?? 'non precise'}
        </p>
      ) : null}
      {profile.status === 'suspended' ? (
        <p className="alerte" role="alert">
          Votre compte vendeur est suspendu. Contactez le support si besoin.
        </p>
      ) : null}

      <section className="page__contenu">
        <h2>Documents</h2>
        <ul className="liste-docs">
          <li>{profile.hasIdentityDocument ? 'Piece d\'identite recue' : "Piece d'identite manquante"}</li>
          <li>{profile.hasSanitaryDocument ? 'Document sanitaire recu' : 'Document sanitaire non fourni'}</li>
          <li>{profile.hasFacilityPhoto ? "Photo de l'installation recue" : "Photo de l'installation manquante"}</li>
          <li>{profile.hasBusinessDocument ? 'Justificatif professionnel recu' : 'Justificatif professionnel non fourni'}</li>
        </ul>
      </section>

      <p className="page__lien">
        <Link to="/vendeur/inscription">Modifier le profil / renvoyer des documents</Link>
      </p>
      <p className="page__lien">
        <Link to="/">Retour a l'accueil</Link>
      </p>
    </main>
  );
}
