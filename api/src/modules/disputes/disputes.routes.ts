import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { singlePhotoUpload } from '../../lib/photo-upload';
import { requireAuth } from '../../middleware/auth';
import { addEvidenceHandler, getEvidencePhotoHandler } from './disputes.controller';

// Le module litiges expose ici les actions menees par les parties (preuves) et le
// service de photo. L'ouverture d'un litige vit dans le routeur des commandes
// (POST /orders/:id/dispute) et les decisions dans le routeur admin.
export const disputesRouter = Router();

disputesRouter.use(requireAuth);

disputesRouter.post('/:id/evidence', singlePhotoUpload, asyncHandler(addEvidenceHandler));

// Photo d'une preuve (doit preceder toute route /:id generique).
disputesRouter.get('/evidence/:id/photo', asyncHandler(getEvidencePhotoHandler));
