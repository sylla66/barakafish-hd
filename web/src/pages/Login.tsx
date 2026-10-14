import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { errorMessage } from '../lib/api';

type Step = 'phone' | 'code';

// Connexion en deux temps : saisie du telephone, envoi de l'OTP, puis saisie du
// code. A la premiere connexion, un nom complet est demande pour creer le compte.
export default function Login() {
  const { requestOtp, verifyOtp, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/profil', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  async function onSubmitPhone(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await requestOtp(phone.trim());
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await verifyOtp(phone.trim(), code.trim(), fullName);
      navigate('/profil', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page page--etroite">
      <header className="page__entete">
        <h1>Connexion</h1>
        <p>Connectez-vous avec votre numero de telephone.</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {step === 'phone' ? (
        <form className="formulaire" onSubmit={onSubmitPhone}>
          <label className="champ">
            <span>Numero de telephone</span>
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+221771234567"
              autoComplete="tel"
              inputMode="tel"
              required
            />
            <small>Format senegalais : +221 puis 9 chiffres (ex. +221771234567).</small>
          </label>

          <button type="submit" className="bouton" disabled={isSubmitting}>
            {isSubmitting ? 'Envoi du code...' : 'Recevoir le code'}
          </button>
        </form>
      ) : (
        <form className="formulaire" onSubmit={onSubmitCode}>
          <p className="info">
            Un code a 6 chiffres a ete envoye au <strong>{phone}</strong>. Il est valable 5 minutes.
          </p>

          <label className="champ">
            <span>Code de verification</span>
            <input
              type="text"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
            />
          </label>

          <label className="champ">
            <span>Nom complet (premiere connexion)</span>
            <input
              type="text"
              name="full_name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Awa Diop"
              autoComplete="name"
            />
            <small>Obligatoire uniquement si vous n'avez pas encore de compte.</small>
          </label>

          <button type="submit" className="bouton" disabled={isSubmitting}>
            {isSubmitting ? 'Verification...' : 'Se connecter'}
          </button>

          <button
            type="button"
            className="bouton bouton--secondaire"
            onClick={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
            disabled={isSubmitting}
          >
            Changer de numero
          </button>
        </form>
      )}

      <p className="page__lien">
        <Link to="/">Retour a l'accueil</Link>
      </p>
    </main>
  );
}
