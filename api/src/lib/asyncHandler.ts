import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Enveloppe une fonction de contrôleur asynchrone pour que rejets de promesse
// soient transmis au middleware global d'erreurs (Express 4 ne le fait pas seul).
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
