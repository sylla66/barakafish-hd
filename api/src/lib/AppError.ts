// Erreur applicative portant un statut HTTP et un message destine a l'utilisateur
// (toujours en francais). Le middleware global s'appuie dessus pour repondre.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, code = 'erreur', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, message, 'requete_invalide', details);
  }

  static unauthorized(message = 'Authentification requise.'): AppError {
    return new AppError(401, message, 'non_authentifie');
  }

  static forbidden(message = 'Acces refuse.'): AppError {
    return new AppError(403, message, 'acces_refuse');
  }

  static notFound(message = 'Ressource introuvable.'): AppError {
    return new AppError(404, message, 'introuvable');
  }

  static conflict(message: string): AppError {
    return new AppError(409, message, 'conflit');
  }
}
