export type SellerStatus = 'pending' | 'verified' | 'suspended' | 'rejected';

export type SellerDocumentType = 'identity' | 'sanitary' | 'facility';

// Vue "proprietaire" : le vendeur voit l'etat de ses documents (presence) mais
// jamais leur contenu sensible via cette forme.
export interface SellerOwnProfile {
  userId: string;
  shopName: string;
  description: string | null;
  zone: string;
  address: string | null;
  status: SellerStatus;
  isVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  hasIdentityDocument: boolean;
  hasSanitaryDocument: boolean;
  hasFacilityPhoto: boolean;
  rejectionReason: string | null;
  verifiedAt: string | null;
}

// Fiche publique : aucun document, aucune donnee de contact.
export interface PublicSellerProfile {
  userId: string;
  shopName: string;
  description: string | null;
  zone: string;
  status: SellerStatus;
  isVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
}

export interface AdminSellerListItem extends SellerOwnProfile {
  fullName: string;
  phone: string;
  createdAt: string;
}
