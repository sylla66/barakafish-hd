export type ListingState = 'fresh' | 'frozen_at_sea' | 'frozen';

export type ListingStatus = 'draft' | 'active' | 'sold_out' | 'archived';

export type ListingSort = 'recent' | 'price_asc' | 'price_desc' | 'rating';

export interface ListingPhoto {
  id: string;
  position: number;
  // Chemin relatif servi par l'API (les fichiers ne sont jamais exposes en statique).
  url: string;
}

// Informations publiques du vendeur attachees a une annonce.
export interface ListingSeller {
  userId: string;
  shopName: string;
  isVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  zone: string;
}

export interface Listing {
  id: string;
  sellerId: string;
  speciesId: number;
  speciesNameFr: string;
  speciesNameWo: string | null;
  title: string;
  description: string | null;
  state: ListingState;
  caughtOrFrozenOn: string;
  storageConditions: string;
  quantityKg: number;
  minOrderKg: number;
  pricePerKg: number;
  zone: string;
  status: ListingStatus;
  // Vrai si l'annonce est sponsorisee et que la mise en avant n'est pas expiree.
  sponsored: boolean;
  seller: ListingSeller;
  photos: ListingPhoto[];
  createdAt: string;
  updatedAt: string;
}

export interface ListingSearchResult {
  listings: Listing[];
  nextCursor: string | null;
}
