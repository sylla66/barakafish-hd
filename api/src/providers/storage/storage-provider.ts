// Contrat de stockage des fichiers (documents vendeurs, photos d'annonces...).
// L'implementation est choisie via STORAGE_PROVIDER : `local` pour le
// developpement, puis s3 ou cloudinary. On expose volontairement une lecture en
// memoire (buffer) pour pouvoir proteger les pieces sensibles derriere une route
// d'API, plutot que de les rendre publiques.
export interface SaveFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  // Dossier logique (ex. `sellers/<userId>`), utilise pour organiser les fichiers.
  category: string;
}

export interface StorageProvider {
  readonly name: string;
  saveFile(input: SaveFileInput): Promise<{ key: string }>;
  readFile(key: string): Promise<{ data: Buffer; contentType: string } | null>;
}
