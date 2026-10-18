import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type PipeTransform,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import type { ApiError, ErrorCode } from '@cashless/shared';
import { isUniqueViolation } from '../db/db';

/** Error de negoci amb un codi estable que els clients poden interpretar. */
export class DomainError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Element') => new DomainError('NOT_FOUND', `${what} no trobat`, HttpStatus.NOT_FOUND);
export const forbidden = (message = 'No tens permís per fer aquesta acció') =>
  new DomainError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const unauthorized = (message = 'Cal iniciar sessió') =>
  new DomainError('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
export const unprocessable = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new DomainError(code, message, HttpStatus.CONFLICT, details);

/** Valida el cos o la consulta d'una petició amb un esquema de zod. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // T és el tipus de sortida (amb els valors per defecte aplicats), no el d'entrada.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('VALIDATION_ERROR', 'Les dades enviades no són vàlides', HttpStatus.BAD_REQUEST, result.error.issues);
    }
    return result.data;
  }
}

/** Dona a tots els errors el mateix format JSON (ApiError). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toApiError(exception);
    if (body.statusCode >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof DomainError) {
      return { statusCode: exception.getStatus(), code: exception.code, message: exception.message, details: exception.details };
    }
    if (isUniqueViolation(exception)) {
      return { statusCode: 409, code: 'CONFLICT', message: 'Ja existeix un element amb aquestes dades' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR';
      return { statusCode: status, code, message: exception.message };
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Error intern del servidor' };
  }
}
