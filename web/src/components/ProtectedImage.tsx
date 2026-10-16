import { useEffect, useState } from 'react';

import { API_BASE_URL } from '../lib/api';
import { getToken } from '../lib/token-storage';

interface ProtectedImageProps {
  path: string;
  alt: string;
  className?: string;
}

// Une balise <img> n'envoie pas l'en-tete Authorization : on recupere l'image
// protegee via fetch puis on l'affiche depuis un object URL.
export function ProtectedImage({ path, alt, className }: ProtectedImageProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const token = getToken();

    fetch(`${API_BASE_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!url) {
    return null;
  }
  return <img className={className} src={url} alt={alt} />;
}
