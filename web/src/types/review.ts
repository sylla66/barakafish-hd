export interface Review {
  id: string;
  orderId: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  listingTitle: string;
  rating: number;
  comment: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface ReviewListResponse {
  reviews: Review[];
  next_cursor: string | null;
}
