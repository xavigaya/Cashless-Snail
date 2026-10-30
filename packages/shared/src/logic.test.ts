import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEuros, parseEuros, vatIncluded } from './money.ts';
import { mergeLines, priceLines, splitDebit, splitDebitAllowingDebt } from './pricing.ts';
import {
  codeFromRandomBytes,
  isValidCode,
  normalizeCode,
  normalizeUid,
  pairingQrPayload,
  parsePairingQr,
  parseWristbandQr,
  wristbandQrPayload,
} from './wristband.ts';

test('parseEuros accepta formats habituals', () => {
  assert.equal(parseEuros('12'), 1200);
  assert.equal(parseEuros('12,5'), 1250);
  assert.equal(parseEuros('12.50'), 1250);
  assert.equal(parseEuros(' 3,05 € '), 305);
  assert.equal(parseEuros('0,1'), 10);
  assert.equal(parseEuros('abc'), null);
  assert.equal(parseEuros('1,234'), null);
  assert.equal(parseEuros('-5'), null);
});

test('formatEuros fa servir el format català', () => {
  assert.match(formatEuros(1250), /12,50/);
});

test('vatIncluded calcula la quota inclosa', () => {
  assert.equal(vatIncluded(1100, 1000), 100);
  assert.equal(vatIncluded(1210, 2100), 210);
  assert.equal(vatIncluded(0, 1000), 0);
});

test('splitDebit gasta primer el saldo promocional', () => {
  assert.deepEqual(splitDebit(500, 300, 1000), { promoCents: 300, paidCents: 200 });
  assert.deepEqual(splitDebit(200, 300, 0), { promoCents: 200, paidCents: 0 });
  assert.deepEqual(splitDebit(0, 0, 0), { promoCents: 0, paidCents: 0 });
  assert.equal(splitDebit(1001, 0, 1000), null);
});

test('priceLines i mergeLines', () => {
  const merged = mergeLines([
    { productId: 'a', quantity: 1 },
    { productId: 'b', quantity: 2 },
    { productId: 'a', quantity: 3 },
  ]);
  assert.deepEqual(merged, [
    { productId: 'a', quantity: 4 },
    { productId: 'b', quantity: 2 },
  ]);
  const priced = priceLines([
    { productId: 'a', name: 'Cervesa', quantity: 4, unitPriceCents: 300, vatRateBps: 1000 },
    { productId: 'b', name: 'Aigua', quantity: 2, unitPriceCents: 150, vatRateBps: 1000 },
  ]);
  assert.equal(priced.totalCents, 1500);
  assert.equal(priced.lines[0]!.totalCents, 1200);
});

test('identificació de polseres', () => {
  assert.equal(normalizeUid('04:a2:3b:1c:ff:00:80'), '04A23B1CFF0080');
  const code = codeFromRandomBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 31, 32]));
  assert.equal(code, '01234567Z0');
  assert.ok(isValidCode(code));
  assert.equal(normalizeCode('abcde-fghjk'), 'ABCDEFGHJK');
  assert.equal(parseWristbandQr(wristbandQrPayload('ABCDEFGHJK')), 'ABCDEFGHJK');
  assert.equal(parseWristbandQr('cs:abcde-fghjk'), 'ABCDEFGHJK');
  assert.equal(parseWristbandQr('hola'), null);
  const pairing = parsePairingQr(pairingQrPayload('https://api.exemple.cat', 'K7P2M9QX'));
  assert.deepEqual(pairing, { type: 'cashless-pairing', apiUrl: 'https://api.exemple.cat', code: 'K7P2M9QX' });
  assert.equal(parsePairingQr('{"type":"altre"}'), null);
});

test('sense connexió: es gasta el promocional i la resta pot deixar deute', () => {
  assert.deepEqual(splitDebitAllowingDebt(600, 0), { promoCents: 0, paidCents: 600 });
  assert.deepEqual(splitDebitAllowingDebt(600, 200), { promoCents: 200, paidCents: 400 });
  assert.deepEqual(splitDebitAllowingDebt(150, 500), { promoCents: 150, paidCents: 0 });
});
