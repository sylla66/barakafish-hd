import type { AuthUser } from '../modules/users/users.types';

// Augmentation du type Request d'Express : requireAuth y depose l'utilisateur.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
