import { useState } from 'react';

const STARS = [1, 2, 3, 4, 5];

interface StarRatingProps {
  value: number;
  count?: number;
}

// Affichage d'une note de 1 a 5 (lecture seule).
export function StarRating({ value, count }: StarRatingProps) {
  const rounded = Math.round(value);
  return (
    <span className="etoiles" aria-label={`Note ${value.toFixed(1)} sur 5`}>
      {STARS.map((star) => (
        <span key={star} className={star <= rounded ? 'etoile etoile--pleine' : 'etoile'} aria-hidden="true">
          ★
        </span>
      ))}
      {count !== undefined ? <span className="etoiles__compte">({count} avis)</span> : null}
    </span>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
}

// Saisie d'une note : clic sur une etoile, survol pour previsualiser.
export function StarRatingInput({ value, onChange }: StarRatingInputProps) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <span className="etoiles etoiles--saisie" role="radiogroup" aria-label="Votre note">
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          className={star <= active ? 'etoile-bouton etoile-bouton--active' : 'etoile-bouton'}
          aria-label={`${star} sur 5`}
          aria-pressed={value === star}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(star)}
        >
          ★
        </button>
      ))}
    </span>
  );
}
