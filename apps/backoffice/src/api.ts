import type { ApiError } from '@cashless/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'cashless.admin.token';

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // El navegador no permet desar dades: la sessió durarà fins que es recarregui la pàgina.
  }
}

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiRequestError({ statusCode: 0, code: 'INTERNAL_ERROR', message: 'No es pot connectar amb el servidor' });
  }
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    throw new ApiRequestError(
      (data as ApiError | undefined) ?? { statusCode: response.status, code: 'INTERNAL_ERROR', message: `Error ${response.status}` },
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};

/** Missatge llegible d'un error, incloent els detalls de validació. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const issues = error.error.details as { path?: (string | number)[]; message: string }[] | undefined;
    if (error.error.code === 'VALIDATION_ERROR' && Array.isArray(issues) && issues.length > 0) {
      return issues.map((i) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join(' · ');
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Error desconegut';
}
