import multer from 'multer';

import { AppError } from '../../lib/AppError';

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

// Les fichiers sont gardes en memoire puis remis au StorageProvider : rien
// n'atterrit sur le disque sans passer par la couche de stockage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 4 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(AppError.badRequest('Format de fichier non autorise. Formats acceptes : JPG, PNG, PDF.'));
      return;
    }
    callback(null, true);
  },
});

// Champs attendus : identite (obligatoire), document sanitaire (optionnel),
// photo de l'installation (obligatoire), justificatif professionnel (optionnel :
// carte de mareyeur ou RCCM).
export const sellerDocumentsUpload = upload.fields([
  { name: 'identity_document', maxCount: 1 },
  { name: 'sanitary_document', maxCount: 1 },
  { name: 'facility_photo', maxCount: 1 },
  { name: 'business_document', maxCount: 1 },
]);
