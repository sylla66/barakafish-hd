export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
  email: string | null;
  isBuyer: boolean;
  isSeller: boolean;
  isAdmin: boolean;
  isBusiness: boolean;
  businessName: string | null;
  city: string | null;
}

export interface UpdateProfileInput {
  full_name?: string;
  email?: string;
  city?: string;
  is_business?: boolean;
  business_name?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string, fullName?: string) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
}
