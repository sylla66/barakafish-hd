import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { ApiError, apiRequest, errorMessage } from '../lib/api';
import type { SellerOwnProfile } from '../types/seller';

type Step = 1 | 2;

interface ProfileResponse {
  profile: SellerOwnProfile;
}

// "Devenir vendeur" en deux etapes : informations de la boutique, puis envoi des
// documents. Si un profil existe deja, on arrive directement a l'etape documents.
export default function BecomeSeller() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [isChecking, setIsChecking] = useState(true);

  const [shopName, setShopName] = useState('');
  const [description, setDescription] = useState('');
  const [zone, setZone] = useState('');
  const [address, setAddress] = useState('');

  const [identity, setIdentity] = useState<File | null>(null);
  const [sanitary, setSanitary] = useState<File | null>(null);
  const [facility, setFacility] = useState<File | null>(null);
  const [business, setBusiness] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  // On regarde si le profil existe deja pour positionner l'etape courante.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let active = true;
    apiRequest<ProfileResponse>('/sellers/profile')
      .then((data) => {
        if (!active) return;
        setShopName(data.profile.shopName);
        setDescription(data.profile.description ?? '');
        setZone(data.profile.zone);
        setAddress(data.profile.address ?? '');
        setStep(2);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          return; // Pas encore de profil : on reste a l'etape 1.
        }
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setIsChecking(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  async function onSubmitProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest<ProfileResponse>('/sellers/profile', {
        method: 'POST',
        body: JSON.stringify({
          shop_name: shopName.trim(),
          description: description.trim() || undefined,
          zone: zone.trim(),
          address: address.trim() || undefined,
        }),
      });
      setStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitDocuments(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!identity) {
      setError("La piece d'identite est obligatoire.");
      return;
    }
    if (!facility) {
      setError("La photo de l'installation est obligatoire.");
      return;
    }

    const form = new FormData();
    form.append('identity_document', identity);
    form.append('facility_photo', facility);
    if (sanitary) {
      form.append('sanitary_document', sanitary);
    }
    if (business) {
      form.append('business_document', business);
    }

    setIsSubmitting(true);
    try {
      await apiRequest<ProfileResponse>('/sellers/documents', { method: 'POST', body: form });
      navigate('/vendeur/statut', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAuthLoading || isChecking) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>Devenir vendeur</h1>
        <p>Etape {step} sur 2 : {step === 1 ? 'votre boutique' : 'vos documents'}.</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <form className="formulaire" onSubmit={onSubmitProfile}>
          <label className="champ">
            <span>Nom de la boutique</span>
            <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          </label>

          <label className="champ">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Type de produits, zone de peche..."
            />
          </label>

          <label className="champ">
            <span>Zone</span>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Dakar, Mbour, Joal..."
              required
            />
          </label>

          <label className="champ">
            <span>Adresse (optionnel)</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>

          <button type="submit" className="bouton" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement...' : 'Continuer'}
          </button>
        </form>
      ) : (
        <form className="formulaire" onSubmit={onSubmitDocuments}>
          <p className="info">
            Formats acceptes : JPG, PNG, PDF. Taille maximale : 5 Mo par fichier.
          </p>

          <label className="champ">
            <span>Piece d'identite (obligatoire)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setIdentity(e.target.files?.[0] ?? null)}
              required
            />
          </label>

          <label className="champ">
            <span>Document sanitaire (optionnel)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setSanitary(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="champ">
            <span>Photo de l'installation (obligatoire)</span>
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => setFacility(e.target.files?.[0] ?? null)}
              required
            />
          </label>

          <label className="champ">
            <span>Justificatif professionnel (optionnel)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setBusiness(e.target.files?.[0] ?? null)}
            />
            <small>Carte de mareyeur ou registre de commerce (RCCM).</small>
          </label>

          <button type="submit" className="bouton" disabled={isSubmitting}>
            {isSubmitting ? 'Envoi...' : 'Envoyer mes documents'}
          </button>
        </form>
      )}

      <p className="page__lien">
        <Link to="/vendeur/statut">Voir mon statut de verification</Link>
      </p>
    </main>
  );
}
