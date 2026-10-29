/** Venedors, punts de venda i productes d'un esdeveniment. */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import {
  createPointOfSaleSchema,
  createProductSchema,
  createVendorSchema,
  updatePointOfSaleSchema,
  updateProductSchema,
  updateVendorSchema,
} from '@cashless/shared';
import { notFound, parseInput, parseUuid, unprocessable } from '../../common/errors';
import { organizations, pointsOfSale, products, vendors } from '../../db/schema';
import { toPointOfSale, toProduct, toVendor } from '../../admin/mappers';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppDeps, type AppEnv } from '../context';

export function catalogRoutes(deps: AppDeps) {
  const { db, access } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>({ strict: false });


  async function assertVendorInEvent(eventId: string, vendorId: string): Promise<void> {
    const [vendor] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.eventId, eventId)))
      .limit(1);
    if (!vendor) throw unprocessable('VALIDATION_ERROR', 'El venedor no pertany a aquest esdeveniment');
  }

  async function assertOrganizationExists(organizationId: string): Promise<void> {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) throw unprocessable('VALIDATION_ERROR', 'L’entitat indicada no existeix');
  }

  // ---------- Venedors ----------

  app.get('/events/:eventId/vendors', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    await access.event(c.get('admin'), eventId);
    return c.json((await db.select().from(vendors).where(eq(vendors.eventId, eventId)).orderBy(asc(vendors.name))).map(toVendor));
  });

  app.post('/events/:eventId/vendors', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const body = parseInput(createVendorSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    if (body.organizationId) await assertOrganizationExists(body.organizationId);
    const [row] = await db
      .insert(vendors)
      .values({ eventId, name: body.name, organizationId: body.organizationId ?? null, commissionBps: body.commissionBps })
      .returning();
    return c.json(toVendor(row!), 201);
  });

  app.patch('/events/:eventId/vendors/:vendorId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const vendorId = parseUuid(c.req.param('vendorId'), 'vendorId');
    const body = parseInput(updateVendorSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    if (body.organizationId) await assertOrganizationExists(body.organizationId);
    const [row] = await db
      .update(vendors)
      .set(body)
      .where(and(eq(vendors.id, vendorId), eq(vendors.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Venedor');
    return c.json(toVendor(row));
  });

  // ---------- Punts de venda ----------

  app.get('/events/:eventId/points-of-sale', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    await access.event(c.get('admin'), eventId);
    const rows = await db.select().from(pointsOfSale).where(eq(pointsOfSale.eventId, eventId)).orderBy(asc(pointsOfSale.name));
    return c.json(rows.map(toPointOfSale));
  });

  app.post('/events/:eventId/points-of-sale', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const body = parseInput(createPointOfSaleSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    if (body.vendorId) await assertVendorInEvent(eventId, body.vendorId);
    const [row] = await db
      .insert(pointsOfSale)
      .values({ eventId, name: body.name, kind: body.kind, vendorId: body.kind === 'box_office' ? null : body.vendorId! })
      .returning();
    return c.json(toPointOfSale(row!), 201);
  });

  app.patch('/events/:eventId/points-of-sale/:posId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const posId = parseUuid(c.req.param('posId'), 'posId');
    const body = parseInput(updatePointOfSaleSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const [row] = await db
      .update(pointsOfSale)
      .set(body)
      .where(and(eq(pointsOfSale.id, posId), eq(pointsOfSale.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Punt de venda');
    return c.json(toPointOfSale(row));
  });

  // ---------- Productes ----------

  app.get('/events/:eventId/products', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    await access.event(c.get('admin'), eventId);
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.eventId, eventId))
      .orderBy(asc(products.vendorId), asc(products.sortOrder), asc(products.name));
    return c.json(rows.map(toProduct));
  });

  app.post('/events/:eventId/products', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const body = parseInput(createProductSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    await assertVendorInEvent(eventId, body.vendorId);
    const [row] = await db
      .insert(products)
      .values({ eventId, ...body })
      .returning();
    return c.json(toProduct(row!), 201);
  });

  app.patch('/events/:eventId/products/:productId', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const productId = parseUuid(c.req.param('productId'), 'productId');
    const body = parseInput(updateProductSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const [before] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.eventId, eventId)))
      .limit(1);
    if (!before) throw notFound('Producte');
    const [row] = await db
      .update(products)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    if (body.priceCents !== undefined && body.priceCents !== before.priceCents) {
      await access.audit(db, admin, {
        eventId,
        action: 'product.price_change',
        targetType: 'product',
        targetId: productId,
        data: { from: before.priceCents, to: body.priceCents },
      });
    }
    return c.json(toProduct(row!));
  });

  return app;
}
