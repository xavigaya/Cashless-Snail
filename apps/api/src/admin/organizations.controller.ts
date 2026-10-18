import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  createAdminUserSchema,
  createEventSchema,
  createOrganizationSchema,
  type AdminRole,
  type CreateAdminUserInput,
  type CreateEventInput,
  type CreateOrganizationInput,
  type EventSummary,
  type Organization,
} from '@cashless/shared';
import { hashSecret } from '../common/crypto';
import { notFound, ZodPipe } from '../common/errors';
import { DB, type Db, type Queryable } from '../db/db';
import { adminUsers, events, organizations, roleAssignments } from '../db/schema';
import { AdminGuard } from '../auth/guards';
import {
  assertCanManageOrganization,
  assertPlatformAdmin,
  canManageEvent,
  CurrentAdmin,
  isPlatformAdmin,
  type AdminPrincipal,
} from '../auth/principals';
import { AdminAccessService } from './admin-access.service';
import { toEvent, toOrganization } from './mappers';

/**
 * Crea un usuari del backoffice (o reutilitza el que ja tingui aquest correu) i li assigna un rol.
 * Si l'usuari ja existeix, no se li canvia la contrasenya.
 */
export async function grantAdminRole(
  db: Queryable,
  input: CreateAdminUserInput,
  role: AdminRole,
  scope: { organizationId?: string; eventId?: string },
): Promise<{ id: string; email: string; name: string }> {
  const [existing] = await db
    .select()
    .from(adminUsers)
    .where(eq(sql`lower(${adminUsers.email})`, input.email.toLowerCase()))
    .limit(1);
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

@Controller()
@UseGuards(AdminGuard)
export class OrganizationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AdminAccessService,
  ) {}

  /** Entitats visibles per a l'usuari: totes si és admin de plataforma; si no, les seves. */
  @Get('organizations')
  async list(@CurrentAdmin() admin: AdminPrincipal): Promise<Organization[]> {
    if (isPlatformAdmin(admin)) {
      return (await this.db.select().from(organizations).orderBy(asc(organizations.name))).map(toOrganization);
    }
    const orgIds = admin.roles.filter((r) => r.organizationId).map((r) => r.organizationId!);
    const eventIds = admin.roles.filter((r) => r.eventId).map((r) => r.eventId!);
    if (eventIds.length > 0) {
      const rows = await this.db.select({ organizationId: events.organizationId }).from(events).where(inArray(events.id, eventIds));
      orgIds.push(...rows.map((r) => r.organizationId));
    }
    if (orgIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(organizations)
      .where(inArray(organizations.id, [...new Set(orgIds)]))
      .orderBy(asc(organizations.name));
    return rows.map(toOrganization);
  }

  @Post('organizations')
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ): Promise<Organization> {
    assertPlatformAdmin(admin);
    const [row] = await this.db
      .insert(organizations)
      .values({ name: body.name, taxId: body.taxId ?? null, taxRegime: body.taxRegime })
      .returning();
    await this.access.audit(this.db, admin, { action: 'organization.create', targetType: 'organization', targetId: row!.id, data: body });
    return toOrganization(row!);
  }

  @Get('organizations/:orgId')
  async get(@CurrentAdmin() admin: AdminPrincipal, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<Organization> {
    const [row] = await this.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!row) throw notFound('Entitat');
    const visible = (await this.list(admin)).some((o) => o.id === orgId);
    if (!visible) throw notFound('Entitat');
    return toOrganization(row);
  }

  @Post('organizations/:orgId/admins')
  async addAdmin(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodPipe(createAdminUserSchema)) body: CreateAdminUserInput,
  ): Promise<{ id: string; email: string; name: string }> {
    assertCanManageOrganization(admin, orgId);
    const user = await grantAdminRole(this.db, body, 'org_admin', { organizationId: orgId });
    await this.access.audit(this.db, admin, { action: 'organization.add_admin', targetType: 'admin_user', targetId: user.id });
    return user;
  }

  @Get('organizations/:orgId/events')
  async events(@CurrentAdmin() admin: AdminPrincipal, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<EventSummary[]> {
    const rows = await this.db.select().from(events).where(eq(events.organizationId, orgId)).orderBy(asc(events.startsAt));
    return rows.filter((e) => canManageEvent(admin, e)).map(toEvent);
  }

  @Post('organizations/:orgId/events')
  async createEvent(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodPipe(createEventSchema)) body: CreateEventInput,
  ): Promise<EventSummary> {
    assertCanManageOrganization(admin, orgId);
    const [row] = await this.db
      .insert(events)
      .values({ organizationId: orgId, ...body })
      .returning();
    await this.access.audit(this.db, admin, { eventId: row!.id, action: 'event.create', targetType: 'event', targetId: row!.id });
    return toEvent(row!);
  }

  /** Tots els esdeveniments on l'usuari té algun permís (per a la pantalla d'inici). */
  @Get('events')
  async allEvents(@CurrentAdmin() admin: AdminPrincipal): Promise<EventSummary[]> {
    const orgs = await this.list(admin);
    if (orgs.length === 0) return [];
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          inArray(
            events.organizationId,
            orgs.map((o) => o.id),
          ),
        ),
      )
      .orderBy(asc(events.startsAt));
    return rows.filter((e) => canManageEvent(admin, e)).map(toEvent);
  }
}
