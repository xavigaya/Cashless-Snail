import type { Balance, CashReport, CashShift, EventTotals, Movement, OperationResult, PairResult, Terminal } from '@cashless/shared';
import type { RunningServer } from '../src/main';
import { Client, createPlatformAdmin, createTestServer, newId, resetDatabase, testSql } from './helpers';

/**
 * Recorregut complet de la fase 0: configuració des del backoffice,
 * vinculació de terminals, activació, recàrrega, venda, anul·lació i resum.
 */
describe('Cashless · fase 0', () => {
  let server: RunningServer;
  let api: Client;
  let admin: Client;
  let eventId: string;
  let orgId: string;
  type Key = 'colla' | 'ampa' | 'bar' | 'box' | 'beer' | 'water' | 'sandwich' | 'cashier' | 'barLead' | 'boxOffice';
  const ids = {} as Record<Key, string>;
  let firstTopupId: string;
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
    server = await createTestServer();
    api = new Client(server.url);

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
    await server?.close();
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
    it('cal obrir la caixa abans de cobrar a la taquilla', async () => {
      const res = await boxOffice.post('/tpv/activations', { id: newId(), wristband }).expect(422);
      expect(res.body.code).toBe('SHIFT_NOT_OPEN');
      expect((await boxOffice.get('/tpv/shift').expect(200)).body).toBeNull();

      const id = newId();
      const shift = (await boxOffice.post('/tpv/shift/open', { id, openingFloatCents: 5000 }).expect(201)).body as CashShift;
      expect(shift).toMatchObject({ id, operatorName: 'Pere', openingFloatCents: 5000, closedAt: null, expectedCashCents: 5000 });
      // Reintent de la mateixa petició: el mateix torn.
      expect((await boxOffice.post('/tpv/shift/open', { id, openingFloatCents: 5000 }).expect(201)).body.id).toBe(id);
      const twice = await boxOffice.post('/tpv/shift/open', { id: newId(), openingFloatCents: 0 }).expect(409);
      expect(twice.body.code).toBe('SHIFT_ALREADY_OPEN');
      await cashier.get('/tpv/shift').expect(403);
    });

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
      firstTopupId = id;
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

    it('un duplicat simultani amb el saldo just retorna el resultat original, no “saldo insuficient”', async () => {
      // Saldo: 700. Una venda de 600 enviada cinc vegades alhora: només es cobra una vegada
      // i totes les respostes són d'èxit (si no, el terminal creuria que no s'ha cobrat).
      const id = newId();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => cashier.post('/tpv/sales', { id, wristband, lines: [{ productId: ids.beer, quantity: 2 }] })),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
      const balance = await cashier.get(`/tpv/balance?uid=${UID}`).expect(200);
      expect(balance.body.paidCents).toBe(100);
    });
  });

  describe('vendes sense connexió', () => {
    const offlineSale = (body: object) => barTerminal.post('/tpv/offline-sales', { operatorId: ids.cashier, clientCreatedAt: new Date().toISOString(), ...body });

    it('registra la venda encara que no hi hagi saldo, i deixa deute', async () => {
      // Saldo: 100. Dues cerveses (600) cobrades sense connexió.
      const id = newId();
      const res = await offlineSale({ id, wristband, lines: [{ productId: ids.beer, quantity: 2, unitPriceCents: 300 }] }).expect(201);
      const result = res.body as OperationResult;
      expect(result.movement).toMatchObject({ type: 'sale', amountCents: 600, offline: true, offlineIssues: ['INSUFFICIENT_BALANCE'], operatorName: 'Marc' });
      expect(result.balance).toMatchObject({ paidCents: -500, debtCents: 500, availableCents: 0 });

      const replay = await offlineSale({ id, wristband, lines: [{ productId: ids.beer, quantity: 2, unitPriceCents: 300 }] }).expect(201);
      expect(replay.body.replayed).toBe(true);
    });

    it('amb deute no es pot comprar fins que es recarrega', async () => {
      const denied = await cashier.post('/tpv/sales', { id: newId(), wristband, lines: [{ productId: ids.water, quantity: 1 }] }).expect(422);
      expect(denied.body.code).toBe('WRISTBAND_IN_DEBT');
      expect(denied.body.details).toEqual({ debtCents: 500 });

      const topup = await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 1000, method: 'cash' }).expect(201);
      expect(topup.body.balance).toMatchObject({ paidCents: 500, debtCents: 0, availableCents: 500 });
    });

    it('una venda que sí que va arribar al servidor no es duplica en sincronitzar-la', async () => {
      const id = newId();
      await cashier.post('/tpv/sales', { id, wristband, lines: [{ productId: ids.water, quantity: 1 }] }).expect(201);
      const sync = await offlineSale({ id, wristband, lines: [{ productId: ids.water, quantity: 1, unitPriceCents: 150 }] }).expect(201);
      expect(sync.body.replayed).toBe(true);
      expect(sync.body.movement.offline).toBe(false);
      expect(sync.body.balance.paidCents).toBe(350);
    });

    it('anota les incidències: polsera desconeguda i preu canviat', async () => {
      const res = await offlineSale({ id: newId(), wristband: { uid: '04DEADBEEF0001' }, lines: [{ productId: ids.water, quantity: 1, unitPriceCents: 100 }] }).expect(201);
      expect(res.body.movement.amountCents).toBe(100);
      expect(res.body.movement.offlineIssues).toEqual(['INSUFFICIENT_BALANCE', 'PRICE_CHANGED', 'WRISTBAND_NOT_ACTIVATED', 'WRISTBAND_NOT_FOUND']);
      expect(res.body.balance.debtCents).toBe(100);
    });

    it('registra igualment la venda d’un operador que ja no existeix', async () => {
      const res = await offlineSale({ id: newId(), operatorId: newId(), wristband, lines: [{ productId: ids.water, quantity: 1, unitPriceCents: 150 }] }).expect(201);
      expect(res.body.movement).toMatchObject({ operatorId: null, offlineIssues: ['NOT_FOUND'] });
      expect(res.body.balance.paidCents).toBe(200);
    });

    it('rebutja (i deixa a l’auditoria) les vendes per sobre del límit o amb productes d’un altre esdeveniment', async () => {
      const over = await offlineSale({ id: newId(), wristband, lines: [{ productId: ids.beer, quantity: 10, unitPriceCents: 300 }] }).expect(422);
      expect(over.body.code).toBe('OVER_OFFLINE_LIMIT');
      const unknown = await offlineSale({ id: newId(), wristband, lines: [{ productId: newId(), quantity: 1, unitPriceCents: 150 }] }).expect(422);
      expect(unknown.body.code).toBe('PRODUCT_UNAVAILABLE');
      // Imports absurds: ni tan sols passen la validació.
      await offlineSale({ id: newId(), wristband, lines: [{ productId: ids.beer, quantity: 99, unitPriceCents: 100000 }] }).expect(400);
      // Cal el token del terminal.
      await api.post('/tpv/offline-sales', {}).expect(401);
    });

    it('el backoffice pot filtrar les vendes amb incidències', async () => {
      const res = await admin.get(`/events/${eventId}/movements?offline=issues`).expect(200);
      expect((res.body.items as Movement[]).map((m) => m.amountCents).sort((a, b) => a - b)).toEqual([100, 150, 600]);
    });
  });

  describe('caixa', () => {
    let laia: Client;

    beforeAll(async () => {
      const op = (await admin.post(`/events/${eventId}/operators`, { name: 'Laia', pin: '6666', role: 'box_office' }).expect(201)).body.id;
      laia = await loginOperator(boxTerminal, op, '6666');
    });

    it('un altre taquiller no pot cobrar dins del torn d’un company', async () => {
      const res = await laia.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'cash' }).expect(422);
      expect(res.body.code).toBe('SHIFT_NOT_OPEN');
    });

    it('tanca el torn comparant l’efectiu declarat amb l’esperat', async () => {
      const open = (await laia.get('/tpv/shift').expect(200)).body as CashShift;
      // Efectiu: polsera 100 + recàrregues 1000 + 900 + 1000. Fons: 5000.
      expect(open).toMatchObject({ cashCents: 3000, cardCents: 0, operations: 4, expectedCashCents: 8000 });

      // Relleu: la Laia compta el calaix i tanca el torn d'en Pere.
      const closed = (await laia.post(`/tpv/shift/${open.id}/close`, { declaredCashCents: 7950, note: 'Falten 50 cèntims' }).expect(200)).body as CashShift;
      expect(closed).toMatchObject({ expectedCashCents: 8000, declaredCashCents: 7950, differenceCents: -50, closedByName: 'Laia' });
      // Reintent del mateix tancament (resposta perduda): el mateix resultat. Un altre import: error.
      expect((await laia.post(`/tpv/shift/${open.id}/close`, { declaredCashCents: 7950 }).expect(200)).body.differenceCents).toBe(-50);
      const again = await laia.post(`/tpv/shift/${open.id}/close`, { declaredCashCents: 0 }).expect(409);
      expect(again.body.code).toBe('SHIFT_CLOSED');

      const res = await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'cash' }).expect(422);
      expect(res.body.code).toBe('SHIFT_NOT_OPEN');
    });

    it('amb la caixa tancada, el reintent d’una recàrrega ja feta retorna l’original (no la torna a cobrar)', async () => {
      const replay = await boxOffice.post('/tpv/topups', { id: firstTopupId, wristband, amountCents: 1000, method: 'cash' }).expect(201);
      expect(replay.body.replayed).toBe(true);
    });

    it('el backoffice veu els torns, el resum per jornada i pot tancar un torn oblidat', async () => {
      const shiftId = newId();
      await boxOffice.post('/tpv/shift/open', { id: shiftId, openingFloatCents: 2000 }).expect(201);
      await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'card' }).expect(201);
      // Una recàrrega en efectiu anul·lada des del backoffice surt del mateix calaix: compta en el torn.
      const cashTopup = (await boxOffice.post('/tpv/topups', { id: newId(), wristband, amountCents: 300, method: 'cash' }).expect(201)).body as OperationResult;
      await admin.post(`/events/${eventId}/voids`, { id: newId(), movementId: cashTopup.movement.id, reason: 'Cobrada per error' }).expect(201);

      const report = (await admin.get(`/events/${eventId}/cash`).expect(200)).body as CashReport;
      expect(report.shifts.map((s) => [s.operatorName, s.closedAt === null, s.cashCents, s.cardCents])).toEqual([
        ['Pere', true, 0, 500],
        ['Pere', false, 3000, 0],
      ]);
      const box = report.daily.find((d) => d.terminalName === 'Taquilla 1')!;
      expect(box).toMatchObject({ pointOfSaleName: 'Taquilla', cashCents: 3000, cardCents: 500, salesCents: 0 });
      const bar = report.daily.find((d) => d.terminalName === 'Barra 1')!;
      // Vendes netes: 1800 de les proves anteriors + 150 + 600, 100 i 150 sense connexió.
      expect(bar).toMatchObject({ cashCents: 0, cardCents: 0, salesCents: 2800 });

      const closed = (await admin.post(`/events/${eventId}/cash/shifts/${shiftId}/close`, { declaredCashCents: 2000 }).expect(200)).body as CashShift;
      expect(closed).toMatchObject({ expectedCashCents: 2000, differenceCents: 0, closedByName: 'Admin (backoffice)' });

      // Torn nou per a la resta de proves de taquilla.
      await boxOffice.post('/tpv/shift/open', { id: newId(), openingFloatCents: 0 }).expect(201);
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
      // Recàrregues: 1000 + 900 + 1000 en efectiu i 500 amb targeta.
      // (Una de 300 en efectiu, anul·lada.)
      // Vendes vàlides: 3 × 300 + 300 (2 aigües) + 600 (2 cerveses) + 150 + 600, 100 i 150 sense connexió. Anul·lades: 750 + 300.
      expect(totals.topupsCents).toBe(3400);
      expect(totals.topupsByMethod).toEqual({ cash: 2900, card: 500, online: 0 });
      expect(totals.salesCents).toBe(2800);
      expect(totals.salesCount).toBe(9);
      expect(totals.voidsCents).toBe(1050);
      expect(totals.wristbandFeesCents).toBe(200);
      // Polsera principal: 700. La desconeguda deu 100, que no es resta del saldo de les altres.
      expect(totals.paidBalanceOutstandingCents).toBe(700);
      expect(totals.debtOutstandingCents).toBe(100);
      expect(totals.offlineSalesCount).toBe(3);
      expect(totals.offlineIssuesCount).toBe(3);
      expect(totals.offlineRejectedCount).toBe(2);
      expect(totals.activeWristbands).toBe(3);
      expect(totals.salesByVendor).toEqual([{ vendorId: ids.colla, vendorName: 'Colla Castellera', salesCents: 2800, count: 9 }]);

      const movements = await admin.get(`/events/${eventId}/movements?limit=5`).expect(200);
      expect(movements.body.items).toHaveLength(5);
      expect(movements.body.nextCursor).toBeTruthy();
      const next = await admin.get(`/events/${eventId}/movements?limit=50&cursor=${movements.body.nextCursor}`).expect(200);
      const allIds = [...movements.body.items, ...next.body.items].map((m: { id: string }) => m.id);
      expect(new Set(allIds).size).toBe(allIds.length);
    });

    it('els saldos coincideixen amb la suma dels moviments', async () => {
      const sql = testSql();
      try {
        const rows = await sql.unsafe(`
          SELECT w.id
          FROM wallets w
          LEFT JOIN movements m ON m.wallet_id = w.id
          GROUP BY w.id, w.paid_cents, w.promo_cents, w.deposit_cents
          HAVING w.paid_cents <> coalesce(sum(m.paid_delta_cents), 0)
              OR w.promo_cents <> coalesce(sum(m.promo_delta_cents), 0)
              OR w.deposit_cents <> coalesce(sum(m.deposit_delta_cents), 0)`);
        expect([...rows]).toEqual([]);
        await expect(sql.unsafe('UPDATE movements SET amount_cents = 0')).rejects.toThrow(/immutables/);
      } finally {
        await sql.end({ timeout: 5 });
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

  describe('activació per esdeveniment', () => {
    // Un segon esdeveniment de la mateixa entitat: el saldo és compartit, però cal activar la polsera a cada esdeveniment.
    let boxOffice2: Client;
    const OTHER_UID = '04FFEEDDCCBBAA';

    beforeAll(async () => {
      const event2 = (
        await admin
          .post(`/organizations/${orgId}/events`, {
            name: 'Fira de tardor 2027',
            slug: 'fira-tardor-2027',
            startsAt: '2027-10-01T08:00:00Z',
            endsAt: '2027-10-03T20:00:00Z',
            wristbandPriceCents: 50,
          })
          .expect(201)
      ).body.id as string;
      await admin.patch(`/events/${event2}`, { status: 'active' }).expect(200);
      const box2 = (await admin.post(`/events/${event2}/points-of-sale`, { name: 'Taquilla fira', kind: 'box_office' }).expect(201)).body.id;
      const op = (await admin.post(`/events/${event2}/operators`, { name: 'Núria', pin: '5555', role: 'box_office' }).expect(201)).body.id;
      const terminal = (await admin.post(`/events/${event2}/terminals`, { name: 'Taquilla fira 1', pointOfSaleId: box2 }).expect(201))
        .body as Terminal;
      boxOffice2 = await loginOperator((await pair(terminal)).client, op, '5555');
      await boxOffice2.post('/tpv/shift/open', { id: newId(), openingFloatCents: 0 }).expect(201);
    });

    it('una polsera activada en un altre esdeveniment no es pot recarregar fins que s’activa en aquest', async () => {
      const before = await boxOffice2.get(`/tpv/balance?uid=${UID}`).expect(200);
      expect(before.body).toMatchObject({ activatedInEvent: false, paidCents: 700 });

      const denied = await boxOffice2.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'cash' }).expect(422);
      expect(denied.body.code).toBe('WRISTBAND_NOT_ACTIVATED');

      const activation = await boxOffice2.post('/tpv/activations', { id: newId(), wristband }).expect(201);
      expect(activation.body.movements[0]).toMatchObject({ type: 'wristband_fee', amountCents: 50 });
      expect(activation.body.balance.activatedInEvent).toBe(true);

      const topup = await boxOffice2.post('/tpv/topups', { id: newId(), wristband, amountCents: 500, method: 'cash' }).expect(201);
      // El saldo és de l'entitat: es manté el que quedava de l'altre esdeveniment.
      expect(topup.body.balance.paidCents).toBe(1200);
    });

    it('una polsera activada només en un altre esdeveniment no pot comprar en aquest', async () => {
      await boxOffice2.post('/tpv/activations', { id: newId(), wristband: { uid: OTHER_UID } }).expect(201);
      await boxOffice2.post('/tpv/topups', { id: newId(), wristband: { uid: OTHER_UID }, amountCents: 1000, method: 'cash' }).expect(201);
      const res = await cashier.post('/tpv/sales', { id: newId(), wristband: { uid: OTHER_UID }, lines: [{ productId: ids.water, quantity: 1 }] }).expect(422);
      expect(res.body.code).toBe('WRISTBAND_NOT_ACTIVATED');
    });
  });

  // Al final: el límit d'intents afecta les rutes d'entrada durant un minut.
  describe('HTTP', () => {
    it('una ruta inexistent retorna un error JSON', async () => {
      const res = await api.get('/no-existeix').expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('un identificador mal format és un error de validació', async () => {
      const res = await admin.get('/events/no-es-un-uuid').expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rebutja els cossos massa grans', async () => {
      const res = await admin.post('/organizations', { name: 'x'.repeat(200_000), taxRegime: 'association' }).expect(413);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('un cos que no és JSON no es llegeix', async () => {
      const res = await api.with({ 'Content-Type': 'text/plain' }).post('/auth/login', 'email=admin@test.cat').expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('bloqueja el compte després de massa contrasenyes errònies', async () => {
      await createPlatformAdmin('bloqueig@test.cat', 'contrasenya-correcta');
      const sql = testSql();
      try {
        // Simula els intents anteriors: el límit per adreça impedeix fer-ne 10 en un minut.
        await sql`UPDATE admin_users SET failed_attempts = 9 WHERE email = 'bloqueig@test.cat'`;
      } finally {
        await sql.end({ timeout: 5 });
      }
      await api.post('/auth/login', { email: 'bloqueig@test.cat', password: 'incorrecta-1234' }).expect(401);
      const res = await api.post('/auth/login', { email: 'bloqueig@test.cat', password: 'contrasenya-correcta' }).expect(429);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('limita els intents de vinculació des d’una mateixa adreça', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        const res = await api.post('/tpv/pair', { pairingCode: 'ZZZZZZZZ' });
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.body.code).toBe('TOO_MANY_REQUESTS');
          break;
        }
      }
      expect(statuses.at(-1)).toBe(429);
      expect(statuses.slice(0, -1).every((s) => s === 401)).toBe(true);
    });
  });
});
