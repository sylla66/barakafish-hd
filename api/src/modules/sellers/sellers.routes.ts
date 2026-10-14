import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  createProfileHandler,
  downloadDocumentHandler,
  getOwnProfileHandler,
  getPublicProfileHandler,
  updateProfileHandler,
  uploadDocumentsHandler,
} from './sellers.controller';
import { sellerDocumentsUpload } from './sellers.upload';

export const sellersRouter = Router();

// Routes du vendeur connecte (doivent precéder /:id).
sellersRouter.get('/profile', requireAuth, asyncHandler(getOwnProfileHandler));
sellersRouter.post('/profile', requireAuth, asyncHandler(createProfileHandler));
sellersRouter.put('/profile', requireAuth, asyncHandler(updateProfileHandler));
sellersRouter.post(
  '/documents',
  requireAuth,
  sellerDocumentsUpload,
  asyncHandler(uploadDocumentsHandler),
);

// Fiche publique (aucune donnee sensible) et telechargement protege des documents.
sellersRouter.get('/:id', asyncHandler(getPublicProfileHandler));
sellersRouter.get('/:id/documents/:type', requireAuth, asyncHandler(downloadDocumentHandler));
