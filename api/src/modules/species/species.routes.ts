import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { listSpeciesHandler } from './species.controller';

export const speciesRouter = Router();

// Catalogue public : necessaire pour le formulaire de creation d'annonce.
speciesRouter.get('/', asyncHandler(listSpeciesHandler));
