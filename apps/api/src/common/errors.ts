import type { ZodType, ZodTypeDef } from 'zod';
import type { ApiError, ErrorCode } from '@cashless/shared';
import { isUniqueViolation } from '../db/db';

/** Error de negoci amb un codi estable que els clients poden interpretar. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what = 'Element') => new DomainError('NOT_FOUND', `${what} no trobat`, 404);
export const forbidden = (message = 'No tens permís per fer aquesta acció') => new DomainError('FORBIDDEN', message, 403);
export const unauthorized = (message = 'Cal iniciar sessió') => new DomainError('UNAUTHORIZED', message, 401);
export const unprocessable = (code: ErrorCode, message: string, details?: unknown) => new DomainError(code, message, 422, details);
export const conflict = (code: ErrorCode, message: string, details?: unknown) => new DomainError(code, message, 409, details);
export const badRequest = (message: string, details?: unknown) => new DomainError('VALIDATION_ERROR', message, 400, details);

/**
 * Valida dades d'entrada (cos, consulta) amb un esquema de zod.
 * T és el tipus de sortida (amb els valors per defecte aplicats), no el d'entrada.
 */
export function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest('Les dades enviades no són vàlides', result.error.issues);
  return result.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(value: string | undefined, name = 'id'): string {
  if (!value || !UUID.test(value)) throw badRequest(`El paràmetre ${name} ha de ser un UUID`);
  return value;
}

/** Converteix qualsevol error al format JSON comú de l'API (ApiError). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof DomainError) {
    return { statusCode: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (isUniqueViolation(error)) {
    return { statusCode: 409, code: 'CONFLICT', message: 'Ja existeix un element amb aquestes dades' };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Error intern del servidor' };
}
