import { env } from '../../config/env';
import { LocalStorageProvider } from './local-storage-provider';
import { S3StorageProvider } from './s3-storage-provider';
import type { StorageProvider } from './storage-provider';

let currentProvider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (!currentProvider) {
    currentProvider = createStorageProvider();
  }
  return currentProvider;
}

function createStorageProvider(): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case 's3':
    case 'cloudinary':
      // cloudinary reutilise le squelette S3 tant qu'il n'est pas implemente.
      return new S3StorageProvider();
    case 'local':
    default:
      return new LocalStorageProvider();
  }
}

export type { StorageProvider, SaveFileInput } from './storage-provider';
