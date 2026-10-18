import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  createPointOfSaleSchema,
  createProductSchema,
  createVendorSchema,
  updatePointOfSaleSchema,
  updateProductSchema,
  updateVendorSchema,
  type CreatePointOfSaleInput,
  type CreateProductInput,
  type CreateVendorInput,
  type PointOfSale,
  type Product,
  type UpdatePointOfSaleInput,
  type UpdateProductInput,
  type UpdateVendorInput,
  type Vendor,
} from '@cashless/shared';
import { notFound, unprocessable, ZodPipe } from '../common/errors';
import { DB, type Db } from '../db/db';
import { organizations, pointsOfSale, products, vendors } from '../db/schema';
import { AdminGuard } from '../auth/guards';
import { CurrentAdmin, type AdminPrincipal } from '../auth/principals';
import { AdminAccessService } from './admin-access.service';
import { toPointOfSale, toProduct, toVendor } from './mappers';

/** Venedors, punts de venda i productes d'un esdeveniment. */
@Controller('events/:eventId')
@UseGuards(AdminGuard)
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AdminAccessService,
  ) {}

  // ---------- Venedors ----------

  @Get('vendors')
  async vendors(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<Vendor[]> {
    await this.access.event(admin, eventId);
    return (await this.db.select().from(vendors).where(eq(vendors.eventId, eventId)).orderBy(asc(vendors.name))).map(toVendor);
  }

  @Post('vendors')
  async createVendor(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createVendorSchema)) body: CreateVendorInput,
  ): Promise<Vendor> {
    await this.access.event(admin, eventId);
    if (body.organizationId) await this.assertOrganizationExists(body.organizationId);
    const [row] = await this.db
      .insert(vendors)
      .values({ eventId, name: body.name, organizationId: body.organizationId ?? null, commissionBps: body.commissionBps })
      .returning();
    return toVendor(row!);
  }

  @Patch('vendors/:vendorId')
  async updateVendor(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body(new ZodPipe(updateVendorSchema)) body: UpdateVendorInput,
  ): Promise<Vendor> {
    await this.access.event(admin, eventId);
    if (body.organizationId) await this.assertOrganizationExists(body.organizationId);
    const [row] = await this.db
      .update(vendors)
      .set(body)
      .where(and(eq(vendors.id, vendorId), eq(vendors.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Venedor');
    return toVendor(row);
  }

  // ---------- Punts de venda ----------

  @Get('points-of-sale')
  async pointsOfSale(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<PointOfSale[]> {
    await this.access.event(admin, eventId);
    const rows = await this.db.select().from(pointsOfSale).where(eq(pointsOfSale.eventId, eventId)).orderBy(asc(pointsOfSale.name));
    return rows.map(toPointOfSale);
  }

  @Post('points-of-sale')
  async createPointOfSale(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createPointOfSaleSchema)) body: CreatePointOfSaleInput,
  ): Promise<PointOfSale> {
    await this.access.event(admin, eventId);
    if (body.vendorId) await this.assertVendorInEvent(eventId, body.vendorId);
    const [row] = await this.db
      .insert(pointsOfSale)
      .values({ eventId, name: body.name, kind: body.kind, vendorId: body.kind === 'box_office' ? null : body.vendorId! })
      .returning();
    return toPointOfSale(row!);
  }

  @Patch('points-of-sale/:posId')
  async updatePointOfSale(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('posId', ParseUUIDPipe) posId: string,
    @Body(new ZodPipe(updatePointOfSaleSchema)) body: UpdatePointOfSaleInput,
  ): Promise<PointOfSale> {
    await this.access.event(admin, eventId);
    const [row] = await this.db
      .update(pointsOfSale)
      .set(body)
      .where(and(eq(pointsOfSale.id, posId), eq(pointsOfSale.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Punt de venda');
    return toPointOfSale(row);
  }

  // ---------- Productes ----------

  @Get('products')
  async products(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<Product[]> {
    await this.access.event(admin, eventId);
    const rows = await this.db
      .select()
      .from(products)
      .where(eq(products.eventId, eventId))
      .orderBy(asc(products.vendorId), asc(products.sortOrder), asc(products.name));
    return rows.map(toProduct);
  }

  @Post('products')
  async createProduct(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createProductSchema)) body: CreateProductInput,
  ): Promise<Product> {
    await this.access.event(admin, eventId);
    await this.assertVendorInEvent(eventId, body.vendorId);
    const [row] = await this.db
      .insert(products)
      .values({ eventId, ...body })
      .returning();
    return toProduct(row!);
  }

  @Patch('products/:productId')
  async updateProduct(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body(new ZodPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<Product> {
    await this.access.event(admin, eventId);
    const [before] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.eventId, eventId)))
      .limit(1);
    if (!before) throw notFound('Producte');
    const [row] = await this.db
      .update(products)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    if (body.priceCents !== undefined && body.priceCents !== before.priceCents) {
      await this.access.audit(this.db, admin, {
        eventId,
        action: 'product.price_change',
        targetType: 'product',
        targetId: productId,
        data: { from: before.priceCents, to: body.priceCents },
      });
    }
    return toProduct(row!);
  }

  // ---------- Comprovacions ----------

  private async assertVendorInEvent(eventId: string, vendorId: string): Promise<void> {
    const [vendor] = await this.db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.eventId, eventId)))
      .limit(1);
    if (!vendor) throw unprocessable('VALIDATION_ERROR', 'El venedor no pertany a aquest esdeveniment');
  }

  private async assertOrganizationExists(organizationId: string): Promise<void> {
    const [org] = await this.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) throw unprocessable('VALIDATION_ERROR', 'L’entitat indicada no existeix');
  }
}
