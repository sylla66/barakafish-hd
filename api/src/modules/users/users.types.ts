// Types partages autour de l'utilisateur (utilises par auth, /me et le middleware).
export type Role = 'buyer' | 'seller' | 'admin';

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

// Un utilisateur peut cumuler les roles (voir schema.sql : colonnes booleennes).
export function hasRole(user: AuthUser, role: Role): boolean {
  switch (role) {
    case 'admin':
      return user.isAdmin;
    case 'seller':
      return user.isSeller;
    case 'buyer':
    default:
      return user.isBuyer;
  }
}
