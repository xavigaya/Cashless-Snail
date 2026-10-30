/**
 * Importació en bloc (des de fitxers CSV del backoffice) i llista de polseres d'un esdeveniment.
 *
 * Els elements es relacionen pel nom, sense distingir majúscules: si ja n'hi ha un amb el mateix nom,
 * s'actualitza; si no, es crea. Tota la importació va en una transacció: o entra sencera o no entra res.
 */
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  importOperatorsSchema,
  importPointsOfSaleSchema,
  importProductsSchema,
  importTerminalsSchema,
  importVendorsSchema,
  importWristbandsSchema,
  normalizeCode,
  normalizeUid,
  type ImportResult,
  type Page,
  type WristbandStatus,
  type WristbandSummary,
} from '@cashless/shared';
import { generateWristbandCode, hashSecret } from '../../common/crypto';
import { DomainError, parseInput, parseUuid } from '../../common/errors';
import type { Tx } from '../../db/db';
import { operators, pointsOfSale, products, terminals, vendors, wristbands } from '../../db/schema';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppContext, type AppDeps, type AppEnv } from '../context';
import { newPairing } from './staff';

const key = (name: string) => name.trim().toLocaleLowerCase('ca');

/** Error d'una fila concreta del fitxer (numerada com a l'Excel: la capçalera és la fila 1). */
function rowError(index: number, message: string): DomainError {
  return new DomainError('VALIDATION_ERROR', `Fila ${index + 2}: ${message}`, 400, { row: index + 2 });
}

const wristbandListQuery = z.object({
  q: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function bulkRoutes(deps: AppDeps) {
  const { db, access } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>({ strict: false });

  const eventIdOf = (c: AppContext) => parseUuid(c.req.param('eventId'), 'eventId');

  async function finish(c: AppContext, eventId: string, kind: string, result: ImportResult) {
    await access.audit(db, c.get('admin'), { eventId, action: `import.${kind}`, data: result });
    return c.json(result);
  }

  async function vendorsByName(tx: Tx, eventId: string) {
    const rows = await tx.select().from(vendors).where(eq(vendors.eventId, eventId));
    return new Map(rows.map((r) => [key(r.name), r]));
  }

  // ---------- Venedors ----------
  app.post('/events/:eventId/import/vendors', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importVendorsSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      const byName = await vendorsByName(tx, eventId);
      for (const row of rows) {
        const existing = byName.get(key(row.name));
        if (existing) {
          await tx.update(vendors).set({ name: row.name, commissionBps: row.commissionBps }).where(eq(vendors.id, existing.id));
          result.updated++;
        } else {
          const [created] = await tx.insert(vendors).values({ eventId, name: row.name, commissionBps: row.commissionBps }).returning();
          byName.set(key(row.name), created!);
          result.created++;
        }
      }
    });
    return finish(c, eventId, 'vendors', result);
  });

  // ---------- Punts de venda ----------
  app.post('/events/:eventId/import/points-of-sale', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importPointsOfSaleSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      const vendorMap = await vendorsByName(tx, eventId);
      const byName = new Map((await tx.select().from(pointsOfSale).where(eq(pointsOfSale.eventId, eventId))).map((r) => [key(r.name), r]));
      for (const [i, row] of rows.entries()) {
        let vendorId: string | null = null;
        if (row.kind !== 'box_office') {
          if (!row.vendorName) throw rowError(i, `cal el venedor de «${row.name}»`);
          const vendor = vendorMap.get(key(row.vendorName));
          if (!vendor) throw rowError(i, `no hi ha cap venedor «${row.vendorName}» (importa primer els venedors)`);
          vendorId = vendor.id;
        }
        const existing = byName.get(key(row.name));
        if (existing) {
          if (existing.kind !== row.kind) throw rowError(i, `«${row.name}» ja existeix amb un altre tipus; el tipus no es pot canviar`);
          await tx
            .update(pointsOfSale)
            .set({ name: row.name, vendorId, ...(row.active !== undefined ? { active: row.active } : {}) })
            .where(eq(pointsOfSale.id, existing.id));
          result.updated++;
        } else {
          const [created] = await tx
            .insert(pointsOfSale)
            .values({ eventId, name: row.name, kind: row.kind, vendorId, active: row.active ?? true })
            .returning();
          byName.set(key(row.name), created!);
          result.created++;
        }
      }
    });
    return finish(c, eventId, 'points_of_sale', result);
  });

  // ---------- Productes ----------
  app.post('/events/:eventId/import/products', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importProductsSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      const vendorMap = await vendorsByName(tx, eventId);
      // Un producte s'identifica pel nom dins del seu venedor.
      const byName = new Map(
        (await tx.select().from(products).where(eq(products.eventId, eventId))).map((r) => [`${r.vendorId}|${key(r.name)}`, r]),
      );
      for (const [i, row] of rows.entries()) {
        const vendor = vendorMap.get(key(row.vendorName));
        if (!vendor) throw rowError(i, `no hi ha cap venedor «${row.vendorName}» (importa primer els venedors)`);
        const { vendorName: _vendorName, active, ...fields } = row;
        const existing = byName.get(`${vendor.id}|${key(row.name)}`);
        if (existing) {
          await tx
            .update(products)
            .set({ ...fields, ...(active !== undefined ? { active } : {}), updatedAt: new Date() })
            .where(eq(products.id, existing.id));
          result.updated++;
        } else {
          const [created] = await tx
            .insert(products)
            .values({ eventId, vendorId: vendor.id, ...fields, active: active ?? true })
            .returning();
          byName.set(`${vendor.id}|${key(row.name)}`, created!);
          result.created++;
        }
      }
    });
    return finish(c, eventId, 'products', result);
  });

  // ---------- Operadors ----------
  app.post('/events/:eventId/import/operators', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importOperatorsSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    // Els hash dels PIN es calculen abans de la transacció (són lents).
    const pinHashes = await Promise.all(rows.map((r) => (r.pin ? hashSecret(r.pin) : Promise.resolve(null))));
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      const byName = new Map((await tx.select().from(operators).where(eq(operators.eventId, eventId))).map((r) => [key(r.name), r]));
      for (const [i, row] of rows.entries()) {
        const pinHash = pinHashes[i];
        const existing = byName.get(key(row.name));
        if (existing) {
          await tx
            .update(operators)
            .set({
              name: row.name,
              role: row.role,
              ...(row.active !== undefined ? { active: row.active } : {}),
              ...(pinHash ? { pinHash, failedAttempts: 0, lockedUntil: null } : {}),
            })
            .where(eq(operators.id, existing.id));
          result.updated++;
        } else {
          if (!pinHash) throw rowError(i, `cal un PIN per a l’operador nou «${row.name}»`);
          const [created] = await tx
            .insert(operators)
            .values({ eventId, name: row.name, role: row.role, pinHash, active: row.active ?? true })
            .returning();
          byName.set(key(row.name), created!);
          result.created++;
        }
      }
    });
    return finish(c, eventId, 'operators', result);
  });

  // ---------- Terminals ----------
  app.post('/events/:eventId/import/terminals', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importTerminalsSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      const posMap = new Map((await tx.select().from(pointsOfSale).where(eq(pointsOfSale.eventId, eventId))).map((r) => [key(r.name), r]));
      const byName = new Map((await tx.select().from(terminals).where(eq(terminals.eventId, eventId))).map((r) => [key(r.name), r]));
      for (const [i, row] of rows.entries()) {
        const pos = posMap.get(key(row.pointOfSaleName));
        if (!pos) throw rowError(i, `no hi ha cap punt de venda «${row.pointOfSaleName}» (importa primer els punts de venda)`);
        const existing = byName.get(key(row.name));
        if (existing) {
          await tx
            .update(terminals)
            .set({ name: row.name, pointOfSaleId: pos.id, ...(row.active !== undefined ? { active: row.active } : {}) })
            .where(eq(terminals.id, existing.id));
          result.updated++;
        } else {
          // Cada terminal nou rep el seu codi de vinculació (vàlid 30 minuts; se'n pot demanar un altre).
          const [created] = await tx
            .insert(terminals)
            .values({ eventId, name: row.name, pointOfSaleId: pos.id, active: row.active ?? true, ...newPairing() })
            .returning();
          byName.set(key(row.name), created!);
          result.created++;
        }
      }
    });
    return finish(c, eventId, 'terminals', result);
  });

  // ---------- Polseres ----------

  /**
   * Registre previ de polseres: es creen sense saldo. Una polsera ja registrada (pel mateix UID o codi) no canvia.
   * Les polseres són de la plataforma, no d'un esdeveniment: es poden fer servir a qualsevol esdeveniment.
   */
  app.post('/events/:eventId/import/wristbands', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const { rows } = parseInput(importWristbandsSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const result: ImportResult = { created: 0, updated: 0, unchanged: 0 };
    await db.transaction(async (tx) => {
      for (const [i, row] of rows.entries()) {
        const [byUid] = row.uid ? await tx.select().from(wristbands).where(eq(wristbands.uid, row.uid)).limit(1) : [];
        const [byCode] = row.code ? await tx.select().from(wristbands).where(eq(wristbands.code, row.code)).limit(1) : [];
        if (byUid && byCode && byUid.id !== byCode.id) throw rowError(i, 'l’UID i el codi ja són de dues polseres diferents');
        const existing = byUid ?? byCode;
        if (existing) {
          if (row.uid && existing.uid && existing.uid !== row.uid) throw rowError(i, `el codi ${existing.code} ja té un altre UID`);
          if (row.code && existing.code !== row.code) throw rowError(i, `l’UID ${row.uid} ja té el codi ${existing.code}`);
          if (row.uid && !existing.uid) {
            await tx.update(wristbands).set({ uid: row.uid }).where(eq(wristbands.id, existing.id));
            result.updated++;
          } else {
            result.unchanged++;
          }
          continue;
        }
        for (let attempt = 0; ; attempt++) {
          const inserted = await tx
            .insert(wristbands)
            .values({ uid: row.uid ?? null, code: row.code ?? generateWristbandCode() })
            .onConflictDoNothing()
            .returning({ id: wristbands.id });
          if (inserted.length > 0) break;
          if (row.code || attempt >= 4) throw rowError(i, 'no s’ha pogut registrar la polsera');
        }
        result.created++;
      }
    });
    return finish(c, eventId, 'wristbands', result);
  });

  /**
   * Polseres que han fet algun moviment en aquest esdeveniment, amb el saldo per a l'entitat.
   * `q` busca per codi o UID (fragment, sense guions).
   */
  app.get('/events/:eventId/wristbands', requireAdmin, async (c) => {
    const eventId = eventIdOf(c);
    const query = parseInput(wristbandListQuery, c.req.query());
    const event = await access.event(c.get('admin'), eventId);
    const text = query.q?.trim() ?? '';
    const pattern = text ? `%${normalizeCode(text)}%` : null;
    const uidPattern = text ? `%${normalizeUid(text)}%` : null;

    const rows = await db.execute<{
      id: string;
      code: string;
      uid: string | null;
      wristband_status: WristbandStatus;
      wallet_status: WristbandStatus;
      paid: number;
      promo: number;
      deposit: number;
      activated: boolean;
      n: number;
      last_at: string;
    }>(sql`
      SELECT w.id, w.code, w.uid, w.status AS wristband_status, wa.status AS wallet_status,
             wa.paid_cents AS paid, wa.promo_cents AS promo, wa.deposit_cents AS deposit,
             bool_or(m.type = 'wristband_fee') AS activated,
             count(*)::int AS n,
             to_char(max(m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_at
      FROM movements m
      JOIN wallets wa ON wa.id = m.wallet_id
      JOIN wristbands w ON w.id = wa.wristband_id
      WHERE m.event_id = ${eventId} AND wa.organization_id = ${event.organizationId}
        ${pattern ? sql`AND (w.code LIKE ${pattern} OR w.uid LIKE ${uidPattern})` : sql``}
      GROUP BY w.id, wa.id
      ORDER BY max(m.created_at) DESC, w.id
      LIMIT ${query.limit + 1} OFFSET ${query.offset}`);

    const items: WristbandSummary[] = rows.slice(0, query.limit).map((r) => {
      const status = r.wristband_status !== 'active' ? r.wristband_status : r.wallet_status;
      return {
        wristbandId: r.id,
        code: r.code,
        uid: r.uid,
        status,
        paidCents: r.paid,
        promoCents: r.promo,
        depositCents: r.deposit,
        availableCents: status === 'active' && r.paid >= 0 ? r.paid + r.promo : 0,
        debtCents: Math.max(0, -r.paid),
        activatedInEvent: r.activated,
        movementsCount: r.n,
        lastMovementAt: r.last_at,
      };
    });
    const page: Page<WristbandSummary> = { items, nextCursor: rows.length > query.limit ? String(query.offset + query.limit) : null };
    return c.json(page);
  });

  return app;
}
