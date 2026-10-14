export type SellerStatus = 'pending' | 'verified' | 'suspended' | 'rejected';

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
  hasBusinessDocument: boolean;
  rejectionReason: string | null;
  verifiedAt: string | null;
}
