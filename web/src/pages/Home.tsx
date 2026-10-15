import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { API_BASE_URL, apiRequest, errorMessage } from '../lib/api';
import {
  STATE_LABEL,
  type Listing,
  type ListingState,
  type SearchListingsResponse,
  type Species,
} from '../types/listing';

const PAGE_LIMIT = 20;

type SortValue = 'recent' | 'price_asc' | 'price_desc' | 'rating';

const SORT_LABEL: Record<SortValue, string> = {
  recent: 'Plus recentes',
  price_asc: 'Prix croissant',
  price_desc: 'Prix decroissant',
  rating: 'Mieux notees',
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'poisson', label: 'Poissons' },
  { value: 'crustacé', label: 'Crustaces' },
  { value: 'céphalopode', label: 'Cephalopodes' },
  { value: 'mollusque', label: 'Mollusques' },
];

interface Filters {
  q: string;
  speciesId: string;
  category: string;
  state: string;
  zone: string;
  priceMin: string;
  priceMax: string;
  sellerVerified: boolean;
  sort: SortValue;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  speciesId: '',
  category: '',
  state: '',
  zone: '',
  priceMin: '',
  priceMax: '',
  sellerVerified: false,
  sort: 'recent',
};

function buildQuery(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.speciesId) params.set('species_id', filters.speciesId);
  if (filters.category) params.set('category', filters.category);
  if (filters.state) params.set('state', filters.state);
  if (filters.zone.trim()) params.set('zone', filters.zone.trim());
  if (filters.priceMin) params.set('price_min', filters.priceMin);
  if (filters.priceMax) params.set('price_max', filters.priceMax);
  if (filters.sellerVerified) params.set('seller_verified', 'true');
  if (filters.sort !== 'recent') params.set('sort', filters.sort);
  params.set('limit', String(PAGE_LIMIT));
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

// Page d'accueil = catalogue : recherche, filtres repliables sur mobile et
// chargement infini de proche en proche (pagination par curseur).
export default function Home() {
  const [species, setSpecies] = useState<Species[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

  const [listings, setListings] = useState<Listing[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiRequest<{ species: Species[] }>('/species')
      .then((data) => setSpecies(data.species))
      .catch(() => undefined);
  }, []);

  // Les changements de filtre sont appliques apres une courte pause : cela evite
  // une requete par frappe dans le champ de recherche.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  const loadFirstPage = useCallback(async (activeFilters: Filters) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setError(null);
    setListings([]);
    setNextCursor(null);

    try {
      const data = await apiRequest<SearchListingsResponse>(
        `/listings?${buildQuery(activeFilters, null)}`,
      );
      if (requestIdRef.current !== requestId) return;
      setListings(data.listings);
      setNextCursor(data.next_cursor);
    } catch (err) {
      if (requestIdRef.current === requestId) setError(errorMessage(err));
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage(applied);
  }, [applied, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (isLoading || isLoadingMore || !nextCursor) return;
    const requestId = requestIdRef.current;

    setIsLoadingMore(true);
    try {
      const data = await apiRequest<SearchListingsResponse>(
        `/listings?${buildQuery(applied, nextCursor)}`,
      );
      if (requestIdRef.current !== requestId) return;
      setListings((previous) => [...previous, ...data.listings]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      if (requestIdRef.current === requestId) setError(errorMessage(err));
    } finally {
      if (requestIdRef.current === requestId) setIsLoadingMore(false);
    }
  }, [applied, isLoading, isLoadingMore, nextCursor]);

  // Chargement infini : on observe un repere en bas de liste.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  function update<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }

  function reset(): void {
    setFilters(EMPTY_FILTERS);
  }

  return (
    <main className="page">
      <header className="page__entete">
        <h1>Baraka Fish HD</h1>
        <p>Poissons et fruits de mer frais et congeles en mer, au Senegal.</p>
      </header>

      <nav className="accueil__actions">
        <Link className="bouton bouton--secondaire" to="/connexion">
          Se connecter
        </Link>
        <Link className="bouton bouton--secondaire" to="/profil">
          Mon profil
        </Link>
        <Link className="bouton bouton--secondaire" to="/vendeur/annonces">
          Mes annonces
        </Link>
        <Link className="bouton bouton--secondaire" to="/commandes">
          Mes commandes
        </Link>
      </nav>

      <form
        className="catalogue-recherche"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(filters);
        }}
      >
        <input
          type="search"
          className="catalogue-recherche__champ"
          placeholder="Rechercher un poisson, un titre..."
          value={filters.q}
          onChange={(event) => update('q', event.target.value)}
          aria-label="Rechercher une annonce"
        />
        <button type="submit" className="bouton">
          Rechercher
        </button>
      </form>

      <button
        type="button"
        className="bouton bouton--secondaire catalogue-filtres__bascule"
        aria-expanded={filtersOpen}
        aria-controls="catalogue-filtres"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {filtersOpen ? 'Masquer les filtres' : 'Filtres'}
      </button>

      <section
        id="catalogue-filtres"
        className={`catalogue-filtres${filtersOpen ? ' catalogue-filtres--ouvert' : ''}`}
      >
        <label className="champ">
          <span>Espece</span>
          <select value={filters.speciesId} onChange={(event) => update('speciesId', event.target.value)}>
            <option value="">Toutes les especes</option>
            {species.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nameFr}
              </option>
            ))}
          </select>
        </label>

        <label className="champ">
          <span>Categorie</span>
          <select value={filters.category} onChange={(event) => update('category', event.target.value)}>
            <option value="">Toutes les categories</option>
            {CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="champ">
          <span>Etat</span>
          <select value={filters.state} onChange={(event) => update('state', event.target.value)}>
            <option value="">Tous les etats</option>
            {(Object.keys(STATE_LABEL) as ListingState[]).map((state) => (
              <option key={state} value={state}>
                {STATE_LABEL[state]}
              </option>
            ))}
          </select>
        </label>

        <label className="champ">
          <span>Zone</span>
          <input
            type="text"
            placeholder="Dakar, Mbour, Joal..."
            value={filters.zone}
            onChange={(event) => update('zone', event.target.value)}
          />
        </label>

        <div className="catalogue-filtres__prix">
          <label className="champ">
            <span>Prix min (FCFA/kg)</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={filters.priceMin}
              onChange={(event) => update('priceMin', event.target.value)}
            />
          </label>
          <label className="champ">
            <span>Prix max (FCFA/kg)</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={filters.priceMax}
              onChange={(event) => update('priceMax', event.target.value)}
            />
          </label>
        </div>

        <label className="champ">
          <span>Trier par</span>
          <select
            value={filters.sort}
            onChange={(event) => update('sort', event.target.value as SortValue)}
          >
            {(Object.keys(SORT_LABEL) as SortValue[]).map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABEL[sort]}
              </option>
            ))}
          </select>
        </label>

        <label className="champ champ--case">
          <input
            type="checkbox"
            checked={filters.sellerVerified}
            onChange={(event) => update('sellerVerified', event.target.checked)}
          />
          <span>Vendeurs verifies uniquement</span>
        </label>

        <button type="button" className="bouton bouton--secondaire" onClick={reset}>
          Reinitialiser
        </button>
      </section>

      {error ? (
        <p className="alerte" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="info">Chargement du catalogue...</p>
      ) : listings.length === 0 ? (
        <p className="info">Aucun resultat pour votre recherche.</p>
      ) : (
        <>
          <p className="catalogue__compte">{listings.length} annonce(s) affichee(s).</p>
          <ul className="catalogue">
            {listings.map((listing) => (
              <li key={listing.id} className="carte">
                {listing.photos[0] ? (
                  <img
                    className="carte__photo"
                    src={`${API_BASE_URL}${listing.photos[0].url}`}
                    alt={listing.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="carte__photo carte__photo--vide">Sans photo</div>
                )}

                <div className="carte__corps">
                  <div className="carte__entete">
                    <h3 className="carte__titre">{listing.title}</h3>
                    {listing.sponsored ? <span className="badge badge--sponsor">Sponsorise</span> : null}
                  </div>
                  <p className="carte__meta">
                    {listing.speciesNameFr}
                    {listing.speciesNameWo ? ` (${listing.speciesNameWo})` : ''} - {STATE_LABEL[listing.state]}
                  </p>
                  <p className="carte__prix">{listing.pricePerKg} FCFA/kg</p>
                  <p className="carte__meta">
                    {listing.zone} - {listing.quantityKg} kg dispo (min {listing.minOrderKg} kg)
                  </p>
                  <p className="carte__vendeur">
                    <span>{listing.seller.shopName}</span>
                    {listing.seller.isVerified ? <span className="badge badge--verifie">Verifie</span> : null}
                    {listing.seller.ratingCount > 0 ? (
                      <span className="carte__note">
                        {listing.seller.ratingAvg.toFixed(1)}/5 ({listing.seller.ratingCount} avis)
                      </span>
                    ) : null}
                  </p>
                  <Link className="bouton bouton--secondaire carte__action" to={`/commander/${listing.id}`}>
                    Commander
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div ref={sentinelRef} className="catalogue__sentinel" aria-hidden="true" />

          {isLoadingMore ? <p className="info">Chargement...</p> : null}
          {!nextCursor && !isLoadingMore ? <p className="info">Fin des resultats.</p> : null}
        </>
      )}
    </main>
  );
}
