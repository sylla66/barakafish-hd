import { AppError } from '../../lib/AppError';
import type { StorageProvider } from './storage-provider';

// Squelette du stockage objet (S3 compatible ou Cloudinary), a completer quand
// on branchera l'infrastructure de production.
// TODO: implementer saveFile/readFile via le SDK choisi, et renvoyer pour
// readFile une URL signee (redirection) plutot qu'un buffer.
export class S3StorageProvider implements StorageProvider {
  public readonly name = 's3';

  public async saveFile(): Promise<{ key: string }> {
    throw new AppError(501, 'Stockage S3 non configure.', 'fournisseur_indisponible');
  }

  public async readFile(): Promise<never> {
    throw new AppError(501, 'Stockage S3 non configure.', 'fournisseur_indisponible');
  }
}
