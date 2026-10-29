import { Hono } from 'hono';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  createAdminUserSchema,
  createEventSchema,
  createOrganizationSchema,
  type EventSummary,
  type Organization,
} from '@cashless/shared';
import { notFound, parseInput, parseUuid } from '../../common/errors';
import { events, organizations } from '../../db/schema';
import {
  assertCanManageOrganization,
  assertPlatformAdmin,
  canManageEvent,
  isPlatformAdmin,
  type AdminPrincipal,
} from '../../auth/principals';
import { grantAdminRole } from '../../admin/admin-access';
import { toEvent, toOrganization } from '../../admin/mappers';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppDeps, type AppEnv } from '../context';

export function organizationRoutes(deps: AppDeps) {
  const { db, access } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>();

  /** Entitats visibles per a l'usuari: totes si és admin de plataforma; si no, les seves. */
  async function visibleOrganizations(admin: AdminPrincipal): Promise<Organization[]> {
    if (isPlatformAdmin(admin)) {
      return (await db.select().from(organizations).orderBy(asc(organizations.name))).map(toOrganization);
    }
    const orgIds = admin.roles.filter((r) => r.organizationId).map((r) => r.organizationId!);
    const eventIds = admin.roles.filter((r) => r.eventId).map((r) => r.eventId!);
    if (eventIds.length > 0) {
      const rows = await db.select({ organizationId: events.organizationId }).from(events).where(inArray(events.id, eventIds));
      orgIds.push(...rows.map((r) => r.organizationId));
    }
    if (orgIds.length === 0) return [];
    const rows = await db
      .select()
      .from(organizations)
      .where(inArray(organizations.id, [...new Set(orgIds)]))
      .orderBy(asc(organizations.name));
    return rows.map(toOrganization);
  }

  app.get('/organizations', requireAdmin, async (c) => c.json(await visibleOrganizations(c.get('admin'))));

  app.post('/organizations', requireAdmin, async (c) => {
    const admin = c.get('admin');
    assertPlatformAdmin(admin);
    const body = parseInput(createOrganizationSchema, await readJson(c));
    const [row] = await db
      .insert(organizations)
      .values({ name: body.name, taxId: body.taxId ?? null, taxRegime: body.taxRegime })
      .returning();
    await access.audit(db, admin, { action: 'organization.create', targetType: 'organization', targetId: row!.id, data: body });
    return c.json(toOrganization(row!), 201);
  });

  app.get('/organizations/:orgId', requireAdmin, async (c) => {
    const orgId = parseUuid(c.req.param('orgId'), 'orgId');
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!row) throw notFound('Entitat');
    const visible = (await visibleOrganizations(c.get('admin'))).some((o) => o.id === orgId);
    if (!visible) throw notFound('Entitat');
    return c.json(toOrganization(row));
  });

  app.post('/organizations/:orgId/admins', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const orgId = parseUuid(c.req.param('orgId'), 'orgId');
    assertCanManageOrganization(admin, orgId);
    const body = parseInput(createAdminUserSchema, await readJson(c));
    const user = await grantAdminRole(db, admin, body, 'org_admin', { organizationId: orgId });
    await access.audit(db, admin, { action: 'organization.add_admin', targetType: 'admin_user', targetId: user.id });
    return c.json(user, 201);
  });

  app.get('/organizations/:orgId/events', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const orgId = parseUuid(c.req.param('orgId'), 'orgId');
    const rows = await db.select().from(events).where(eq(events.organizationId, orgId)).orderBy(asc(events.startsAt));
    return c.json(rows.filter((e) => canManageEvent(admin, e)).map(toEvent) satisfies EventSummary[]);
  });

  app.post('/organizations/:orgId/events', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const orgId = parseUuid(c.req.param('orgId'), 'orgId');
    assertCanManageOrganization(admin, orgId);
    const body = parseInput(createEventSchema, await readJson(c));
    const [row] = await db
      .insert(events)
      .values({ organizationId: orgId, ...body })
      .returning();
    await access.audit(db, admin, { eventId: row!.id, action: 'event.create', targetType: 'event', targetId: row!.id });
    return c.json(toEvent(row!), 201);
  });

  /** Tots els esdeveniments on l'usuari té algun permís (per a la pantalla d'inici). */
  app.get('/events', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const orgs = await visibleOrganizations(admin);
    if (orgs.length === 0) return c.json([]);
    const rows = await db
      .select()
      .from(events)
      .where(
        inArray(
          events.organizationId,
          orgs.map((o) => o.id),
        ),
      )
      .orderBy(asc(events.startsAt));
    return c.json(rows.filter((e) => canManageEvent(admin, e)).map(toEvent));
  });

  return app;
}
