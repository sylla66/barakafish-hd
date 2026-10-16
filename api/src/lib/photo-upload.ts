import type { Request } from 'express';
import multer from 'multer';

import { AppError } from './AppError';

// Upload d'une photo unique (reception de commande, photo d'avis...). Les images
// sont gardees en memoire puis reencodees par lib/image.ts avant stockage.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(AppError.badRequest('Format de photo non autorise. Formats acceptes : JPG, PNG, WEBP.'));
      return;
    }
    callback(null, true);
  },
});

// Champ attendu : `photo`. Les autres champs du formulaire restent disponibles
// dans req.body (rating, comment...).
export const singlePhotoUpload = upload.single('photo');

export function uploadedPhoto(req: Request): Express.Multer.File | undefined {
  return req.file ?? undefined;
}
