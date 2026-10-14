import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env';
import { AppError } from '../lib/AppError';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Middleware global de gestion des erreurs. Toutes les reponses d'erreur ont la
// meme forme et sont en francais ; on ne divulgue jamais de details techniques
// en production.
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      champ: issue.path.join('.') || '(racine)',
      message: issue.message,
    }));
    const body: ErrorBody = {
      error: {
        code: 'validation',
        message: 'Les donnees envoyees sont invalides.',
        details,
      },
    };
    res.status(422).json(body);
    return;
  }

  if (error instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
    res.status(error.statusCode).json(body);
    return;
  }

  // Erreur inattendue : on journalise cote serveur, message generique cote client.
  console.error('[erreur] non geree :', error);

  const body: ErrorBody = {
    error: {
      code: 'erreur_interne',
      message: "Une erreur interne est survenue. Veuillez reessayer plus tard.",
    },
  };

  if (!isProduction && error instanceof Error) {
    body.error.details = { debug: error.message };
  }

  res.status(500).json(body);
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = {
    error: {
      code: 'route_introuvable',
      message: "La ressource demandee n'existe pas.",
    },
  };
  res.status(404).json(body);
}
