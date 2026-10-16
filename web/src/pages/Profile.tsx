import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { errorMessage } from '../lib/api';
import type { UpdateProfileInput } from '../types/auth';

// Page profil : consultation et mise a jour des informations, deconnexion.
export default function Profile() {
  const { user, isLoading, isAuthenticated, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [isBusiness, setIsBusiness] = useState(false);
  const [businessName, setBusinessName] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setEmail(user.email ?? '');
      setCity(user.city ?? '');
      setIsBusiness(user.isBusiness);
      setBusinessName(user.businessName ?? '');
    }
  }, [user]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    const payload: UpdateProfileInput = {
      full_name: fullName.trim(),
      city: city.trim(),
      is_business: isBusiness,
      business_name: businessName.trim(),
    };
    // On n'envoie l'email que s'il est renseigne (vide = on ne touche pas).
    if (email.trim().length > 0) {
      payload.email = email.trim();
    }

    try {
      await updateProfile(payload);
      setSuccess('Profil mis a jour.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function onLogout(): void {
    logout();
    navigate('/', { replace: true });
  }

  if (isLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement du profil...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const roles: string[] = [];
  if (user.isBuyer) roles.push('Acheteur');
  if (user.isSeller) roles.push('Vendeur');
  if (user.isAdmin) roles.push('Admin');

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>Mon profil</h1>
        <p>
          {user.phone} - {roles.join(', ') || 'Aucun role'}
        </p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="succes">{success}</p> : null}

      <form className="formulaire" onSubmit={onSubmit}>
        <label className="champ">
          <span>Nom complet</span>
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </label>

        <label className="champ">
          <span>Email (optionnel)</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vous@exemple.com"
          />
        </label>

        <label className="champ">
          <span>Ville (optionnel)</span>
          <input
            type="text"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Dakar"
          />
        </label>

        <label className="champ champ--case">
          <input
            type="checkbox"
            checked={isBusiness}
            onChange={(event) => setIsBusiness(event.target.checked)}
          />
          <span>Acheteur professionnel (B2B)</span>
        </label>

        {isBusiness ? (
          <label className="champ">
            <span>Nom de l'entreprise</span>
            <input
              type="text"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Ex. Sow Seafood SARL"
            />
          </label>
        ) : null}

        <button type="submit" className="bouton" disabled={isSubmitting}>
          {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>

      {user.isAdmin ? (
        <p className="page__lien">
          <Link to="/admin/litiges">Espace admin - Litiges</Link>
        </p>
      ) : null}

      <button type="button" className="bouton bouton--danger" onClick={onLogout}>
        Se deconnecter
      </button>

      <p className="page__lien">
        <Link to="/">Retour a l'accueil</Link>
      </p>
    </main>
  );
}
