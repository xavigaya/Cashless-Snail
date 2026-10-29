/**
 * Dades de demostració: un administrador de plataforma, una entitat i un esdeveniment
 * amb venedors, punts de venda, productes, operadors i terminals a punt per vincular.
 * Ús: pnpm db:seed   (és idempotent: si l'esdeveniment de demo ja existeix, no fa res)
 */
import { eq } from 'drizzle-orm';
import { formatEuros } from '@cashless/shared';
import { loadEnvFile } from '../config';
import { generatePairingCode, hashSecret } from '../common/crypto';
import { createDb, createSql } from './db';
import { runMigrations } from './migrate';
import { adminUsers, events, operators, organizations, pointsOfSale, products, roleAssignments, terminals, vendors } from './schema';

const DEMO_SLUG = 'festa-major-demo';

async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const client = createSql(url, { max: 1 });
  const db = createDb(client);
  try {
    await runMigrations(client);

    const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@cashless.local';
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'canvia-aquesta-contrasenya';
    let [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    if (!admin) {
      [admin] = await db.insert(adminUsers).values({ email, name: 'Administrador', passwordHash: await hashSecret(password) }).returning();
      await db.insert(roleAssignments).values({ userId: admin!.id, role: 'platform_admin' });
      console.log(`Administrador de plataforma: ${email} / ${password}`);
    }

    const [existing] = await db.select().from(events).where(eq(events.slug, DEMO_SLUG)).limit(1);
    if (existing) {
      console.log('Les dades de demostració ja existeixen.');
      return;
    }

    const [org] = await db.insert(organizations).values({ name: 'Comissió de Festes (demo)', taxRegime: 'association' }).returning();
    const start = new Date();
    const [event] = await db
      .insert(events)
      .values({
        organizationId: org!.id,
        name: 'Festa Major (demo)',
        slug: DEMO_SLUG,
        status: 'active',
        startsAt: start,
        endsAt: new Date(start.getTime() + 3 * 24 * 3_600_000),
        wristbandPriceCents: 100,
        wristbandDepositCents: 0,
        maxBalanceCents: 20000,
      })
      .returning();

    const [colla] = await db.insert(vendors).values({ eventId: event!.id, name: 'Colla Castellera' }).returning();
    const [ampa] = await db.insert(vendors).values({ eventId: event!.id, name: 'AMPA', commissionBps: 500 }).returning();

    const [barra] = await db.insert(pointsOfSale).values({ eventId: event!.id, vendorId: colla!.id, name: 'Barra principal', kind: 'bar' }).returning();
    const [cuina] = await db.insert(pointsOfSale).values({ eventId: event!.id, vendorId: ampa!.id, name: 'Cuina AMPA', kind: 'kitchen' }).returning();
    const [taquilla] = await db.insert(pointsOfSale).values({ eventId: event!.id, name: 'Taquilla 1', kind: 'box_office' }).returning();

    await db.insert(products).values([
      { eventId: event!.id, vendorId: colla!.id, name: 'Cervesa', priceCents: 300, category: 'Begudes', color: '#C98A1B', sortOrder: 1 },
      { eventId: event!.id, vendorId: colla!.id, name: 'Refresc', priceCents: 250, category: 'Begudes', color: '#C2402F', sortOrder: 2 },
      { eventId: event!.id, vendorId: colla!.id, name: 'Aigua', priceCents: 150, category: 'Begudes', color: '#3B6FB6', sortOrder: 3 },
      { eventId: event!.id, vendorId: colla!.id, name: 'Got reutilitzable', priceCents: 100, vatRateBps: 2100, category: 'Altres', color: '#5B6B73', sortOrder: 9 },
      { eventId: event!.id, vendorId: ampa!.id, name: 'Entrepà', priceCents: 450, category: 'Menjar', color: '#7A5B2E', destination: 'kitchen', sortOrder: 1 },
      { eventId: event!.id, vendorId: ampa!.id, name: 'Coca de recapte', priceCents: 400, category: 'Menjar', color: '#8E6C3A', destination: 'kitchen', sortOrder: 2 },
    ]);

    const ops = [
      { name: 'Anna (cap de barra)', role: 'bar_lead' as const, pin: '1111' },
      { name: 'Marc (caixer)', role: 'cashier' as const, pin: '2222' },
      { name: 'Laia (cambrera)', role: 'waiter' as const, pin: '3333' },
      { name: 'Pere (taquiller)', role: 'box_office' as const, pin: '4444' },
    ];
    for (const op of ops) {
      await db.insert(operators).values({ eventId: event!.id, name: op.name, role: op.role, pinHash: await hashSecret(op.pin) });
    }

    const expires = new Date(Date.now() + 24 * 3_600_000);
    const terminalRows = await db
      .insert(terminals)
      .values([
        { eventId: event!.id, pointOfSaleId: barra!.id, name: 'Barra 1', pairingCode: generatePairingCode(), pairingExpiresAt: expires },
        { eventId: event!.id, pointOfSaleId: cuina!.id, name: 'Cuina 1', pairingCode: generatePairingCode(), pairingExpiresAt: expires },
        { eventId: event!.id, pointOfSaleId: taquilla!.id, name: 'Taquilla 1', pairingCode: generatePairingCode(), pairingExpiresAt: expires },
      ])
      .returning();

    console.log(`\nEsdeveniment de demostració creat: ${event!.name} (preu de la polsera ${formatEuros(event!.wristbandPriceCents)})`);
    console.log('\nOperadors (PIN):');
    for (const op of ops) console.log(`  ${op.name}: ${op.pin}`);
    console.log('\nCodis de vinculació dels terminals (vàlids 24 hores):');
    for (const t of terminalRows) console.log(`  ${t.name}: ${t.pairingCode}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
