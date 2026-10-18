import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import type { Balance, EventTotals, OperationResult, PairResult, Terminal } from '@cashless/shared';
import { Client, createPlatformAdmin, createTestApp, newId, resetDatabase, TEST_DATABASE_URL } from './helpers';

/**
 * Recorregut complet de la fase 0: configuració des del backoffice,
 * vinculació de terminals, activació, recàrrega, venda, anul·lació i resum.
 */
describe('Cashless · fase 0', () => {
  let app: INestApplication;
  let api: Client;
  let admin: Client;
  let eventId: string;
  let orgId: string;
  const ids: Record<string, string> = {};
  let barTerminal: Client; // terminal de barra, sense operador
  let boxTerminal: Client; // terminal de taquilla, sense operador
  let cashier: Client;
  let barLead: Client;
  let boxOffice: Client;

  const UID = '04A1B2C3D4E5F6';
  const wristband = { uid: UID };

  async function pair(terminal: Terminal): Promise<{ client: Client; result: PairResult }> {
    const res = await api.post('/tpv/pair', { pairingCode: terminal.pairingCode, deviceName: 'Mòbil de proves' }).expect(200);
    const result = res.body as PairResult;
    return { client: api.with({ 'X-Terminal-Token': result.terminalToken }), result };
  }

  async function loginOperator(terminal: Client, operatorId: string, pin: string): Promise<Client> {
    const res = await terminal.post('/tpv/login', { operatorId, pin }).expect(200);
    return terminal.with({ Authorization: `Bearer ${res.body.token}` });
  }

  beforeAll(async () => {
    await resetDatabase();
    await createPlatformAdmin('admin@test.cat', 'contrasenya-de-proves');
    app = await createTestApp();
    api = new Client(app);

    const login = await api.post('/auth/login', { email: 'admin@test.cat', password: 'contrasenya-de-proves' }).expect(200);
    admin = api.with({ Authorization: `Bearer ${login.body.token}` });

    orgId = (await admin.post('/organizations', { name: 'Comissió de Festes', taxRegime: 'association' }).expect(201)).body.id;
    eventId = (
      await admin
        .post(`/organizations/${orgId}/events`, {
          name: 'Festa Major 2027',
          slug: 'festa-major-2027',
          startsAt: '2027-08-14T16:00:00Z',
          endsAt: '2027-08-18T04:00:00Z',
          wristbandPriceCents: 100,
          maxBalanceCents: 5000,
        })
        .expect(201)
    ).body.id;

    const e = `/events/${eventId}`;
    ids.colla = (await admin.post(`${e}/vendors`, { name: 'Colla Castellera' }).expect(201)).body.id;
    ids.ampa = (await admin.post(`${e}/vendors`, { name: 'AMPA', commissionBps: 500 }).expect(201)).body.id;
    ids.bar = (await admin.post(`${e}/points-of-sale`, { name: 'Barra', kind: 'bar', vendorId: ids.colla }).expect(201)).body.id;
    ids.box = (await admin.post(`${e}/points-of-sale`, { name: 'Taquilla', kind: 'box_office' }).expect(201)).body.id;
    ids.beer = (await admin.post(`${e}/products`, { vendorId: ids.colla, name: 'Cervesa', priceCents: 300 }).expect(201)).body.id;
    ids.water = (await admin.post(`${e}/products`, { vendorId: ids.colla, name: 'Aigua', priceCents: 150 }).expect(201)).body.id;
    ids.sandwich = (await admin.post(`${e}/products`, { vendorId: ids.ampa, name: 'Entrepà', priceCents: 450 }).expect(201)).body.id;
    ids.cashier = (await admin.post(`${e}/operators`, { name: 'Marc', pin: '2222', role: 'cashier' }).expect(201)).body.id;
    ids.barLead = (await admin.post(`${e}/operators`, { name: 'Anna', pin: '1111', role: 'bar_lead' }).expect(201)).body.id;
    ids.boxOffice = (await admin.post(`${e}/operators`, { name: 'Pere', pin: '4444', role: 'box_office' }).expect(201)).body.id;

    const barT = (await admin.post(`${e}/terminals`, { name: 'Barra 1', pointOfSaleId: ids.bar }).expect(201)).body as Terminal;
    const boxT = (await admin.post(`${e}/terminals`, { name: 'Taquilla 1', pointOfSaleId: ids.box }).expect(201)).body as Terminal;
    expect(barT.pairingCode).toMatch(/^[2-9A-Z]{8}$/);

    const barPair = await pair(barT);
    barTerminal = barPair.client;
    expect(barPair.result.context.pointOfSale.kind).toBe('bar');
    // A la barra només es mostren els rols de barra.
    expect(barPair.result.context.operators.map((o) => o.name).sort()).toEqual(['Anna', 'Marc']);
    boxTerminal = (await pair(boxT)).client;

    // L'esdeveniment comença en esborrany: s'activa.
    await admin.patch(e, { status: 'active' }).expect(200);

    cashier = await loginOperator(barTerminal, ids.cashier, '2222');
    barLead = await loginOperator(barTerminal, ids.barLead, '1111');
    boxOffice = await loginOperator(boxTerminal, ids.boxOffice, '4444');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('terminals i operadors', () => {
    it('rebutja un codi de vinculació incorrecte o ja utilitzat', async () => {
      const res = await api.post('/tpv/pair', { pairingCode: 'ZZZZZZZZ' }).expect(401);
      expect(res.body.code).toBe('INVALID_PAIRING_CODE');
    });

    it('rebutja un PIN incorrecte', async () => {
      const res = await barTerminal.post('/tpv/login', { operatorId: ids.cashier, pin: '9999' }).expect(401);
      expect(res.body.code).toBe('INVALID_PIN');
    });

    it('no deixa entrar un taquiller en una barra', async () => {
      const res = await barTerminal.post('/tpv/login', { operatorId: ids.boxOffice, pin: '4444' }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_FOR_ROLE');
    });

    it('exigeix terminal i sessió per operar', async () => {
      await api.get('/tpv/catalog').expect(401);
      await barTerminal.get('/tpv/catalog').expect(401);
      const res = await cashier.get('/tpv/catalog').expect(200);
      expect(res.body.map((p: { name: string }) => p.name).sort()).toEqual(['Aigua', 'Cervesa']);
    });
  });

  describe('activació i recàrrega', () => {
    it('una polsera desconeguda no pot comprar', async () => {
      const res = await cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.beer, quantity: 1 }] }).expect(404);
      expect(res.body.code).toBe('WRISTBAND_NOT_FOUND');
    });

    it('activa la polsera cobrant-ne el preu, una sola vegada', async () => {
      const id = newId();
      const first = await boxOffice.post('/tpv/activations', { id, wristband }).expect(201);
      expect(first.body.replayed).toBe(false);
      expect(first.body.movements[0]).toMatchObject({ type: 'wristband_fee', amountCents: 100, paymentMethod: 'cash' });
      expect(first.body.balance.code).toMatch(/^[0-9A-Z]{10}$/);

      const replay = await boxOffice.post('/tpv/activations', { id, wristband }).expect(201);
      expect(replay.body.replayed).toBe(true);

      const again = await boxOffice.post('/tpv/activations', { id: newId(), wristband }).expect(422);
      expect(again.body.code).toBe('ALREADY_ACTIVATED');
    });

    it('recarrega i és idempotent', async () => {
      const id = newId();
      const res = await boxOffice.post('/tpv/topups', { id, wristband, amountCents: 1000, method: 'cash' }).expect(201);
      const result = res.body as OperationResult;
      expect(result.balance).toMatchObject({ paidCents: 1000, availableCents: 1000 });

      const replay = await boxOffice.post('/tpv/topups', { id, wristband, amountCents: 1000, method: 'cash' }).expect(201);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.balance.paidCents).toBe(1000);

      const conflict = await boxOffice.post('/tpv/topups', { id, wristband, amountCents: 2000, method: 'cash' }).expect(409);
      expect(conflict.body.code).toBe('MOVEMENT_CONFLICT');
    });

    it('respecta el saldo màxim per polsera', async () => {
      const res = await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 4500, method: 'card' }).expect(422);
      expect(res.body.code).toBe('MAX_BALANCE_EXCEEDED');
    });

    it('no es pot recarregar des d’una barra', async () => {
      await cashier.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'cash' }).expect(403);
    });
  });

  describe('vendes i anul·lacions', () => {
    let saleId: string;

    it('ven calculant els preus al servidor', async () => {
      saleId = newId();
      const res = await cashier
        .post('/tpv/sales', {
          id: saleId,
          wristband,
          lines: [
            { productId: ids.beer, quantity: 1 },
            { productId: ids.water, quantity: 1 },
            { productId: ids.beer, quantity: 1 },
          ],
        })
        .expect(201);
      const result = res.body as OperationResult;
      expect(result.movement).toMatchObject({ type: 'sale', amountCents: 750, paidDeltaCents: -750, operatorName: 'Marc' });
      expect(result.movement.lines).toHaveLength(2);
      expect(result.balance.paidCents).toBe(250);
    });

    it('rebutja una venda sense saldo suficient', async () => {
      const res = await cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.beer, quantity: 1 }] }).expect(422);
      expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
      expect(res.body.details).toEqual({ totalCents: 300, availableCents: 250 });
    });

    it('no ven productes d’un altre venedor', async () => {
      const res = await cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.sandwich, quantity: 1 }] }).expect(422);
      expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('només el cap de barra pot anul·lar, i una sola vegada', async () => {
      const denied = await cashier.post('/tpv/voids', { id: newId(), movementId: saleId, reason: 'Error del caixer' }).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_FOR_ROLE');

      const ok = await barLead.post('/tpv/voids', { id: newId(), movementId: saleId, reason: 'Error del caixer' }).expect(201);
      expect(ok.body.movement).toMatchObject({ type: 'void', reversesMovementId: saleId, paidDeltaCents: 750 });
      expect(ok.body.balance.paidCents).toBe(1000);

      const twice = await barLead.post('/tpv/voids', { id: newId(), movementId: saleId, reason: 'Repetit' }).expect(409);
      expect(twice.body.code).toBe('ALREADY_VOIDED');
    });

    it('no permet gastar més del saldo amb vendes simultànies', async () => {
      // Saldo: 1000. Deu vendes de 300 alhora: només n'hi caben tres.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.beer, quantity: 1 }] }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 422)).toHaveLength(7);
      const balance = await cashier.get(`/tpv/balance?uid=${UID}`).expect(200);
      expect((balance.body as Balance).paidCents).toBe(100);
    });

    it('una mateixa petició repetida alhora només es comptabilitza una vegada', async () => {
      await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 900, method: 'cash' }).expect(201);
      const id = newId();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => cashier.post('/tpv/sales', { id, wristband, lines: [{ productId: ids.water, quantity: 2 }] })),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
      const balance = await cashier.get(`/tpv/balance?uid=${UID}`).expect(200);
      expect(balance.body.paidCents).toBe(700);
    });
  });

  describe('backoffice', () => {
    it('bloqueja i desbloqueja una polsera', async () => {
      const lookup = await admin.get(`/events/${eventId}/wristbands/lookup?uid=${UID}`).expect(200);
      const wristbandId = lookup.body.balance.wristbandId as string;
      expect(lookup.body.movements.length).toBeGreaterThan(0);

      await admin.patch(`/events/${eventId}/wristbands/${wristbandId}/status`, { status: 'blocked' }).expect(200);
      const res = await cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.water, quantity: 1 }] }).expect(422);
      expect(res.body.code).toBe('WRISTBAND_BLOCKED');
      await admin.patch(`/events/${eventId}/wristbands/${wristbandId}/status`, { status: 'active' }).expect(200);
    });

    it('activa una polsera pel codi imprès (QR)', async () => {
      const res = await boxOffice.post('/tpv/activations', { id: newId(), wristband: { code: 'abcde-fghjk' } }).expect(201);
      expect(res.body.balance.code).toBe('ABCDEFGHJK');
    });

    it('el resum quadra amb el llibre de moviments', async () => {
      const res = await admin.get(`/events/${eventId}/summary`).expect(200);
      const totals = res.body as EventTotals;
      // Recàrregues: 1000 + 900. Vendes vàlides: 3 × 300 + 1 × 300 (2 aigües). Anul·lades: 750.
      expect(totals.topupsCents).toBe(1900);
      expect(totals.topupsByMethod.cash).toBe(1900);
      expect(totals.salesCents).toBe(1200);
      expect(totals.salesCount).toBe(4);
      expect(totals.voidsCents).toBe(750);
      expect(totals.wristbandFeesCents).toBe(200);
      expect(totals.paidBalanceOutstandingCents).toBe(700);
      expect(totals.activeWristbands).toBe(2);
      expect(totals.salesByVendor).toEqual([{ vendorId: ids.colla, vendorName: 'Colla Castellera', salesCents: 1200, count: 4 }]);

      const movements = await admin.get(`/events/${eventId}/movements?limit=5`).expect(200);
      expect(movements.body.items).toHaveLength(5);
      expect(movements.body.nextCursor).toBeTruthy();
      const next = await admin.get(`/events/${eventId}/movements?limit=50&cursor=${movements.body.nextCursor}`).expect(200);
      const allIds = [...movements.body.items, ...next.body.items].map((m: { id: string }) => m.id);
      expect(new Set(allIds).size).toBe(allIds.length);
    });

    it('els saldos coincideixen amb la suma dels moviments', async () => {
      const pool = new Pool({ connectionString: TEST_DATABASE_URL });
      try {
        const { rows } = await pool.query(`
          SELECT w.id
          FROM wallets w
          LEFT JOIN movements m ON m.wallet_id = w.id
          GROUP BY w.id, w.paid_cents, w.promo_cents, w.deposit_cents
          HAVING w.paid_cents <> coalesce(sum(m.paid_delta_cents), 0)
              OR w.promo_cents <> coalesce(sum(m.promo_delta_cents), 0)
              OR w.deposit_cents <> coalesce(sum(m.deposit_delta_cents), 0)`);
        expect(rows).toEqual([]);
        await expect(pool.query('UPDATE movements SET amount_cents = 0')).rejects.toThrow(/immutables/);
      } finally {
        await pool.end();
      }
    });

    it('un administrador d’una altra entitat no hi té accés', async () => {
      const other = (await admin.post('/organizations', { name: 'Altra entitat', taxRegime: 'company' }).expect(201)).body.id;
      await admin.post(`/organizations/${other}/admins`, { email: 'altra@test.cat', name: 'Altra', password: 'una-contrasenya-llarga' }).expect(201);
      const login = await api.post('/auth/login', { email: 'altra@test.cat', password: 'una-contrasenya-llarga' }).expect(200);
      const otherAdmin = api.with({ Authorization: `Bearer ${login.body.token}` });
      await otherAdmin.get(`/events/${eventId}`).expect(403);
      await otherAdmin.get(`/events/${eventId}/summary`).expect(403);
      const orgs = await otherAdmin.get('/organizations').expect(200);
      expect(orgs.body.map((o: { id: string }) => o.id)).toEqual([other]);
    });

    it('desactivar un terminal el deixa sense accés', async () => {
      const terminals = (await admin.get(`/events/${eventId}/terminals`).expect(200)).body as Terminal[];
      const box = terminals.find((t) => t.name === 'Taquilla 1')!;
      await admin.patch(`/events/${eventId}/terminals/${box.id}`, { active: false }).expect(200);
      const res = await boxOffice.get('/tpv/context').expect(403);
      expect(res.body.code).toBe('TERMINAL_DISABLED');
    });
  });
});
