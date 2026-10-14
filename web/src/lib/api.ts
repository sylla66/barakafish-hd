import { getToken } from './token-storage';

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Petit client fetch : ajoute le jeton Bearer et normalise les erreurs de l'API
// (qui repond toujours { error: { code, message } }).
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'reseau', 'Impossible de joindre le serveur. Verifiez votre connexion.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    const body = payload as ErrorResponse | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'erreur',
      body?.error?.message ?? 'Une erreur est survenue.',
    );
  }

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Une erreur inattendue est survenue.';
}
