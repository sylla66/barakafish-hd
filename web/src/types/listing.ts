export type ListingState = 'fresh' | 'frozen_at_sea' | 'frozen';

export type ListingStatus = 'draft' | 'active' | 'sold_out' | 'archived';

export interface ListingPhoto {
  id: string;
  position: number;
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

export interface Species {
  id: number;
  nameFr: string;
  nameWo: string | null;
  category: string;
}

export const STATE_LABEL: Record<ListingState, string> = {
  fresh: 'Frais (glace)',
  frozen_at_sea: 'Congele en mer',
  frozen: 'Congele a terre',
};

export const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Brouillon',
  active: 'Active',
  sold_out: 'Epuisee',
  archived: 'Archivee',
};
