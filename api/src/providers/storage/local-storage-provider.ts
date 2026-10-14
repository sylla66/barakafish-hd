import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../../config/env';
import type { SaveFileInput, StorageProvider } from './storage-provider';

const CONTENT_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

// Stockage local sur disque, hors du dossier servi par le front. Les fichiers ne
// sont accessibles que via la route protegee de l'API (jamais exposes en statique).
export class LocalStorageProvider implements StorageProvider {
  public readonly name = 'local';
  private readonly root = path.resolve(env.UPLOAD_DIR);

  public async saveFile(input: SaveFileInput): Promise<{ key: string }> {
    const key = path.posix.join(input.category, `${randomUUID()}${extensionFor(input)}`);
    const absolute = path.join(this.root, key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.buffer);
    return { key };
  }

  public async readFile(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    const absolute = this.resolveWithinRoot(key);
    if (!absolute) {
      return null;
    }

    try {
      const data = await readFile(absolute);
      return { data, contentType: CONTENT_BY_EXTENSION[path.extname(absolute)] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  // Empeche toute traversee de chemin (../) en dehors de la racine de stockage.
  private resolveWithinRoot(key: string): string | null {
    const absolute = path.resolve(this.root, key);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      return null;
    }
    return absolute;
  }
}

function extensionFor(input: SaveFileInput): string {
  switch (input.mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'application/pdf':
      return '.pdf';
    default: {
      const ext = path.extname(input.originalName).toLowerCase();
      return ext.length > 0 ? ext : '.bin';
    }
  }
}
