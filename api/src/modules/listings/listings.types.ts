export type ListingState = 'fresh' | 'frozen_at_sea' | 'frozen';

export type ListingStatus = 'draft' | 'active' | 'sold_out' | 'archived';

export interface ListingPhoto {
  id: string;
  position: number;
  // Chemin relatif servi par l'API (les fichiers ne sont jamais exposes en statique).
  url: string;
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
  photos: ListingPhoto[];
  createdAt: string;
  updatedAt: string;
}
