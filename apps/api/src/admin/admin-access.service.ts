import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { notFound } from '../common/errors';
import { DB, type Db, type Queryable } from '../db/db';
import { auditLog, events, type EventRow } from '../db/schema';
import { assertCanManageEvent, type AdminPrincipal } from '../auth/principals';

/** Càrrega d'esdeveniments amb comprovació de permisos, i registre d'auditoria. */
@Injectable()
export class AdminAccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

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
