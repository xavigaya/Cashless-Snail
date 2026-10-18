import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { OperatorRole, PosKind, RoleAssignment } from '@cashless/shared';
import { forbidden } from '../common/errors';

/** Usuari del backoffice autenticat. */
export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  roles: RoleAssignment[];
}

/** Terminal vinculat que fa la petició. */
export interface TerminalPrincipal {
  id: string;
  name: string;
  eventId: string;
  organizationId: string;
  pointOfSaleId: string;
  posKind: PosKind;
  vendorId: string | null;
}

/** Operador (voluntari) que ha entrat amb el seu PIN en un terminal. */
export interface OperatorPrincipal {
  id: string;
  name: string;
  role: OperatorRole;
  eventId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminPrincipal;
      terminal?: TerminalPrincipal;
      operator?: OperatorPrincipal;
    }
  }
}

function fromRequest<K extends 'admin' | 'terminal' | 'operator'>(key: K) {
  return createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const value = ctx.switchToHttp().getRequest<Request>()[key];
    if (!value) throw new Error(`Falta ${key} a la petició: revisa els guards del controlador`);
    return value;
  });
}

export const CurrentAdmin = fromRequest('admin');
export const CurrentTerminal = fromRequest('terminal');
export const CurrentOperator = fromRequest('operator');

// ---------- Permisos del backoffice ----------

export function isPlatformAdmin(admin: AdminPrincipal): boolean {
  return admin.roles.some((r) => r.role === 'platform_admin');
}

export function canManageOrganization(admin: AdminPrincipal, organizationId: string): boolean {
  return isPlatformAdmin(admin) || admin.roles.some((r) => r.role === 'org_admin' && r.organizationId === organizationId);
}

export function canManageEvent(admin: AdminPrincipal, event: { id: string; organizationId: string }): boolean {
  return (
    canManageOrganization(admin, event.organizationId) ||
    admin.roles.some((r) => r.role === 'event_manager' && r.eventId === event.id)
  );
}

export function assertPlatformAdmin(admin: AdminPrincipal): void {
  if (!isPlatformAdmin(admin)) throw forbidden('Només un administrador de plataforma pot fer-ho');
}

export function assertCanManageOrganization(admin: AdminPrincipal, organizationId: string): void {
  if (!canManageOrganization(admin, organizationId)) throw forbidden('No tens permís sobre aquesta entitat');
}

export function assertCanManageEvent(admin: AdminPrincipal, event: { id: string; organizationId: string }): void {
  if (!canManageEvent(admin, event)) throw forbidden('No tens permís sobre aquest esdeveniment');
}

// ---------- Permisos dels operadors ----------

export const SALE_ROLES: readonly OperatorRole[] = ['cashier', 'waiter', 'bar_lead'];
export const BOX_OFFICE_ROLES: readonly OperatorRole[] = ['box_office'];
export const VOID_ROLES: readonly OperatorRole[] = ['bar_lead'];
