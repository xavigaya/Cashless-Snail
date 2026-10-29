import { eq, sql } from 'drizzle-orm';
import type { AdminRole, CreateAdminUserInput } from '@cashless/shared';
import { hashSecret } from '../common/crypto';
import { conflict, notFound } from '../common/errors';
import type { Db, Queryable } from '../db/db';
import { adminUsers, auditLog, events, roleAssignments, type EventRow } from '../db/schema';
import { assertCanManageEvent, isPlatformAdmin, type AdminPrincipal } from '../auth/principals';

/** Càrrega d'esdeveniments amb comprovació de permisos, i registre d'auditoria. */
export class AdminAccess {
  constructor(private readonly db: Db) {}

  async event(admin: AdminPrincipal, eventId: string): Promise<EventRow> {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw notFound('Esdeveniment');
    assertCanManageEvent(admin, event);
    return event;
  }

  async audit(
    db: Queryable,
    admin: AdminPrincipal,
    entry: { eventId?: string | null; action: string; targetType?: string; targetId?: string; data?: unknown },
  ): Promise<void> {
    await db.insert(auditLog).values({
      actorType: 'admin',
      actorId: admin.id,
      eventId: entry.eventId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      data: entry.data ?? null,
    });
  }
}

/**
 * Crea un usuari del backoffice i li assigna un rol.
 *
 * Seguretat: si el correu ja existeix, només un administrador de plataforma hi pot afegir rols.
 * Altrament, l'administrador d'una entitat podria crear el compte d'una persona d'una altra entitat
 * amb una contrasenya que ell coneix i, més endavant, entrar-hi amb els permisos que li donessin.
 * (Fase 2: substituir per invitació per correu perquè cada persona triï la seva contrasenya.)
 */
export async function grantAdminRole(
  db: Queryable,
  grantor: AdminPrincipal,
  input: CreateAdminUserInput,
  role: AdminRole,
  scope: { organizationId?: string; eventId?: string },
): Promise<{ id: string; email: string; name: string }> {
  const [existing] = await db
    .select()
    .from(adminUsers)
    .where(eq(sql`lower(${adminUsers.email})`, input.email.toLowerCase()))
    .limit(1);
  if (existing && !isPlatformAdmin(grantor)) {
    throw conflict('CONFLICT', 'Ja existeix un usuari amb aquest correu. Demana a l’administrador de plataforma que li assigni el rol.');
  }
  const user =
    existing ??
    (
      await db
        .insert(adminUsers)
        .values({ email: input.email, name: input.name, passwordHash: await hashSecret(input.password) })
        .returning()
    )[0]!;
  await db
    .insert(roleAssignments)
    .values({ userId: user.id, role, organizationId: scope.organizationId ?? null, eventId: scope.eventId ?? null })
    .onConflictDoNothing();
  return { id: user.id, email: user.email, name: user.name };
}
