import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { apiRequest, errorMessage } from '../lib/api';
import { compressImage } from '../lib/image';
import type { Listing, Species } from '../types/listing';

interface SpeciesResponse {
  species: Species[];
}

interface ListingResponse {
  listing: Listing;
}

const MAX_PHOTOS = 5;

function todayString(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// Formulaire mobile first de creation d'annonce : champs obligatoires + photos
// compressees cote client avant envoi.
export default function CreateListing() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  const [species, setSpecies] = useState<Species[]>([]);
  const [speciesId, setSpeciesId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState('fresh');
  const [date, setDate] = useState(todayString());
  const [storageConditions, setStorageConditions] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [minOrderKg, setMinOrderKg] = useState('1');
  const [pricePerKg, setPricePerKg] = useState('');
  const [zone, setZone] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate('/connexion', { replace: true });
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  useEffect(() => {
    let active = true;
    apiRequest<SpeciesResponse>('/species')
      .then((data) => {
        if (!active) return;
        setSpecies(data.species);
        if (data.species.length > 0) {
          setSpeciesId(String(data.species[0].id));
        }
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  function onSelectPhotos(files: FileList | null): void {
    if (!files) {
      setPhotos([]);
      return;
    }
    setPhotos(Array.from(files).slice(0, MAX_PHOTOS));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append('species_id', speciesId);
      form.append('title', title.trim());
      if (description.trim()) form.append('description', description.trim());
      form.append('state', state);
      form.append('caught_or_frozen_on', date);
      form.append('storage_conditions', storageConditions.trim());
      form.append('quantity_kg', quantityKg);
      form.append('min_order_kg', minOrderKg);
      form.append('price_per_kg', pricePerKg);
      form.append('zone', zone.trim());

      const compressed = await Promise.all(photos.map((photo) => compressImage(photo)));
      compressed.forEach((photo) => form.append('photos', photo));

      await apiRequest<ListingResponse>('/listings', { method: 'POST', body: form });
      navigate('/vendeur/annonces', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setIsSubmitting(false);
    }
  }

  if (isAuthLoading) {
    return (
      <main className="page page--etroite">
        <p className="info">Chargement...</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__entete">
        <h1>Nouvelle annonce</h1>
        <p>Au moins une photo est necessaire pour publier l'annonce.</p>
      </header>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      <form className="formulaire" onSubmit={onSubmit}>
        <label className="champ">
          <span>Espece</span>
          <select value={speciesId} onChange={(e) => setSpeciesId(e.target.value)} required>
            {species.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nameFr}
                {item.nameWo ? ` (${item.nameWo})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="champ">
          <span>Titre</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Thiof frais du jour"
            required
          />
        </label>

        <label className="champ">
          <span>Description (optionnel)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>

        <label className="champ">
          <span>Etat du produit</span>
          <select value={state} onChange={(e) => setState(e.target.value)} required>
            <option value="fresh">Frais (glace)</option>
            <option value="frozen_at_sea">Congele en mer</option>
            <option value="frozen">Congele a terre</option>
          </select>
        </label>

        <label className="champ">
          <span>Date de peche ou de congelation</span>
          <input type="date" value={date} max={todayString()} onChange={(e) => setDate(e.target.value)} required />
          {state === 'fresh' ? <small>Un produit frais doit dater de 3 jours maximum.</small> : null}
        </label>

        <label className="champ">
          <span>Conditions de conservation</span>
          <input
            type="text"
            value={storageConditions}
            onChange={(e) => setStorageConditions(e.target.value)}
            placeholder="Glace, chambre froide -18 C..."
            required
          />
        </label>

        <label className="champ">
          <span>Quantite disponible (kg)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={quantityKg}
            onChange={(e) => setQuantityKg(e.target.value)}
            required
          />
        </label>

        <label className="champ">
          <span>Commande minimum (kg)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={minOrderKg}
            onChange={(e) => setMinOrderKg(e.target.value)}
            required
          />
        </label>

        <label className="champ">
          <span>Prix au kilo (FCFA)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={pricePerKg}
            onChange={(e) => setPricePerKg(e.target.value)}
            required
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
          <span>Photos ({photos.length}/{MAX_PHOTOS})</span>
          <input type="file" accept="image/*" multiple onChange={(e) => onSelectPhotos(e.target.files)} />
          <small>JPG, PNG ou WEBP. 5 photos maximum, compressees avant l'envoi.</small>
        </label>

        <button type="submit" className="bouton" disabled={isSubmitting}>
          {isSubmitting ? 'Publication...' : "Publier l'annonce"}
        </button>
      </form>

      <p className="page__lien">
        <Link to="/vendeur/annonces">Mes annonces</Link>
      </p>
    </main>
  );
}
