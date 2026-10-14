import multer from 'multer';

import { AppError } from '../../lib/AppError';

export const MAX_LISTING_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_LISTING_PHOTOS = 5;

// Les photos d'annonces sont des images uniquement (contrairement aux documents
// vendeur qui acceptent aussi le PDF).
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LISTING_PHOTO_BYTES, files: MAX_LISTING_PHOTOS },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(AppError.badRequest('Format de photo non autorise. Formats acceptes : JPG, PNG, WEBP.'));
      return;
    }
    callback(null, true);
  },
});

// Creation : les champs sont dans le meme formulaire multipart que les photos.
export const listingCreateUpload = upload.fields([{ name: 'photos', maxCount: MAX_LISTING_PHOTOS }]);

// Ajout de photos a une annonce existante.
export const listingPhotosUpload = upload.fields([{ name: 'photos', maxCount: MAX_LISTING_PHOTOS }]);
