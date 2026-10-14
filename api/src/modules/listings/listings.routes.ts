import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  addPhotosHandler,
  archiveListingHandler,
  createListingHandler,
  getListingHandler,
  getListingPhotoHandler,
  listMyListingsHandler,
  removePhotoHandler,
  updateListingHandler,
} from './listings.controller';
import { listingCreateUpload, listingPhotosUpload } from './listings.upload';

export const listingsRouter = Router();

// Routes specifiques (doivent preceder /:id).
listingsRouter.get('/mine', requireAuth, asyncHandler(listMyListingsHandler));
listingsRouter.get('/photos/:photoId', asyncHandler(getListingPhotoHandler));

listingsRouter.post(
  '/',
  requireAuth,
  listingCreateUpload,
  asyncHandler(createListingHandler),
);

// Fiche publique d'une annonce.
listingsRouter.get('/:id', asyncHandler(getListingHandler));

// Gestion par le proprietaire.
listingsRouter.put('/:id', requireAuth, asyncHandler(updateListingHandler));
listingsRouter.delete('/:id', requireAuth, asyncHandler(archiveListingHandler));
listingsRouter.post(
  '/:id/photos',
  requireAuth,
  listingPhotosUpload,
  asyncHandler(addPhotosHandler),
);
listingsRouter.delete('/:id/photos/:photoId', requireAuth, asyncHandler(removePhotoHandler));
