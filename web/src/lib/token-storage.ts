const TOKEN_KEY = 'baraka.auth.token';

// Note securite : cote navigateur, il n'existe pas de stockage reellement sur.
// On retient localStorage pour le MVP ; la variante "httpOnly cookie" exigerait
// des changements cote API. Le jeton expire de lui-meme au bout de 7 jours.
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Stockage indisponible (navigation privee stricte) : session en memoire seule.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Rien a faire.
  }
}
