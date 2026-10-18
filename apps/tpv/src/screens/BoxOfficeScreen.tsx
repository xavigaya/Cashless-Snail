/**
 * Taquilla: activar polseres i recarregar saldo.
 * Flux: llegir la polsera → (activar-la si és nova) → triar import i forma de pagament → recarregar.
 */
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatCode, formatEuros, type Balance, type OperatorSession, type TerminalContext, type WristbandRef } from '@cashless/shared';
import { ApiRequestError, newOperationId, type TpvApi } from '../api';
import { BigButton, Header, NumberPad, ResultOverlay, Screen, styles as ui, type ResultState } from '../components';
import { errorResult } from '../feedback';
import { colors, sizes } from '../theme';
import { WristbandReader } from '../WristbandReader';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

type Current = { ref: WristbandRef; balance: Balance } | { ref: WristbandRef; balance: null };

export function BoxOfficeScreen({ api, context, session, onLogout }: { api: TpvApi; context: TerminalContext; session: OperatorSession; onLogout: () => void }) {
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [amount, setAmount] = useState<number>(1000);
  const [customDigits, setCustomDigits] = useState<string | null>(null);
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  // Identificador de l'operació en curs: es reutilitza només si es reintenta la mateixa operació.
  const pendingId = useRef<{ key: string; id: string } | null>(null);

  const price = context.event.wristbandPriceCents;
  const deposit = context.event.wristbandDepositCents;
  const effectiveAmount = customDigits !== null ? Number(customDigits || '0') * 100 : amount;

  async function onRead(ref: WristbandRef) {
    setReading(false);
    pendingId.current = null;
    try {
      setCurrent({ ref, balance: await api.balance(ref) });
    } catch (e) {
      if (e instanceof ApiRequestError && e.error.code === 'WRISTBAND_NOT_FOUND') setCurrent({ ref, balance: null });
      else setResult(errorResult(e, 'No s’ha pogut llegir la polsera'));
    }
  }

  async function run<T>(key: string, action: (id: string) => Promise<T>, onOk: (value: T) => void, failTitle: string) {
    setBusy(true);
    if (pendingId.current?.key !== key) pendingId.current = { key, id: newOperationId() };
    try {
      const value = await action(pendingId.current.id);
      pendingId.current = null;
      onOk(value);
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.isNetwork)) pendingId.current = null;
      setResult(errorResult(e, failTitle));
    } finally {
      setBusy(false);
    }
  }

  const activate = () =>
    void run(
      `activate:${method}`,
      (id) => api.activate(id, current!.ref, method),
      (res) => {
        setCurrent({ ref: current!.ref, balance: res.balance });
        setResult({ ok: true, title: 'Polsera activada', detail: `Cobra ${formatEuros(price + deposit)} (${method === 'cash' ? 'efectiu' : 'targeta'})` });
      },
      'No s’ha pogut activar',
    );

  const topup = () =>
    void run(
      `topup:${effectiveAmount}:${method}`,
      (id) => api.topup(id, current!.ref, effectiveAmount, method),
      (res) => {
        setCurrent({ ref: current!.ref, balance: res.balance });
        setCustomDigits(null);
        setResult({
          ok: true,
          title: `+${formatEuros(effectiveAmount)}`,
          detail: `Cobra ${formatEuros(effectiveAmount)} en ${method === 'cash' ? 'efectiu' : 'targeta'} · saldo ${formatEuros(res.balance.availableCents)}`,
        });
      },
      'No s’ha pogut recarregar',
    );

  return (
    <Screen>
      <Header title={context.pointOfSale.name} subtitle={session.operator.name} right={<BigButton label="Surt" tone="ghost" onPress={onLogout} style={local.headerButton} />} />
      <ScrollView contentContainerStyle={local.body}>
        {!current ? (
          <View style={local.start}>
            <Text style={[ui.title, { textAlign: 'center' }]}>Taquilla</Text>
            <Text style={[ui.muted, { textAlign: 'center', marginBottom: 20 }]}>
              Polsera: {formatEuros(price)}
              {deposit > 0 ? ` + fiança ${formatEuros(deposit)}` : ''}
            </Text>
            <BigButton label="Llegeix una polsera" tone="accent" onPress={() => setReading(true)} style={{ minHeight: 120 }} />
          </View>
        ) : (
          <>
            <View style={local.card}>
              {current.balance ? (
                <>
                  <Text style={ui.muted}>Polsera {formatCode(current.balance.code)}</Text>
                  <Text style={local.balance}>{formatEuros(current.balance.availableCents)}</Text>
                  {current.balance.status !== 'active' && <Text style={ui.error}>Polsera bloquejada: no es pot recarregar</Text>}
                </>
              ) : (
                <>
                  <Text style={ui.title}>Polsera nova</Text>
                  <Text style={ui.muted}>
                    Cal activar-la abans de recarregar: {formatEuros(price)}
                    {deposit > 0 ? ` + fiança ${formatEuros(deposit)}` : ''}
                  </Text>
                </>
              )}
            </View>

            <Text style={local.label}>Forma de pagament</Text>
            <View style={local.row}>
              <BigButton label="Efectiu" tone={method === 'cash' ? 'accent' : 'neutral'} onPress={() => setMethod('cash')} style={{ flex: 1 }} />
              <BigButton label="Targeta" tone={method === 'card' ? 'accent' : 'neutral'} onPress={() => setMethod('card')} style={{ flex: 1 }} />
            </View>

            {!current.balance ? (
              <BigButton label={`Activa · ${formatEuros(price + deposit)}`} tone="accent" busy={busy} onPress={activate} style={{ marginTop: 20, minHeight: 80 }} />
            ) : (
              <>
                <Text style={local.label}>Import a recarregar</Text>
                <View style={local.row}>
                  {QUICK_AMOUNTS.map((a) => (
                    <BigButton
                      key={a}
                      label={formatEuros(a)}
                      tone={customDigits === null && amount === a ? 'accent' : 'neutral'}
                      onPress={() => {
                        setCustomDigits(null);
                        setAmount(a);
                      }}
                      style={{ flex: 1 }}
                    />
                  ))}
                </View>
                {customDigits === null ? (
                  <BigButton label="Un altre import" tone="ghost" onPress={() => setCustomDigits('')} style={{ marginTop: sizes.gap }} />
                ) : (
                  <View style={{ marginTop: sizes.gap }}>
                    <Text style={[local.balance, { fontSize: 36 }]}>{formatEuros(effectiveAmount)}</Text>
                    <NumberPad
                      onDigit={(d) => setCustomDigits((v) => ((v ?? '') + d).replace(/^0+/, '').slice(0, 3))}
                      onDelete={() => setCustomDigits((v) => (v ?? '').slice(0, -1))}
                      onClear={() => setCustomDigits('')}
                    />
                  </View>
                )}
                <BigButton
                  label={`Recarrega ${formatEuros(effectiveAmount)}`}
                  tone="accent"
                  busy={busy}
                  disabled={effectiveAmount <= 0 || current.balance.status !== 'active'}
                  onPress={topup}
                  style={{ marginTop: 20, minHeight: 80 }}
                />
              </>
            )}

            <View style={[local.row, { marginTop: 20 }]}>
              <BigButton label="Una altra polsera" tone="ghost" onPress={() => setReading(true)} style={{ flex: 1 }} />
              <BigButton label="Acaba" tone="ghost" onPress={() => setCurrent(null)} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </ScrollView>

      <WristbandReader visible={reading} title="Llegeix la polsera" onCancel={() => setReading(false)} onRead={(ref) => void onRead(ref)} />
      <ResultOverlay result={result} onDismiss={() => setResult(null)} />
    </Screen>
  );
}

const local = StyleSheet.create({
  headerButton: { minHeight: 44, paddingHorizontal: 12 },
  body: { padding: 20, gap: 4, flexGrow: 1 },
  start: { flex: 1, justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: sizes.radius, padding: 18, gap: 4 },
  balance: { color: colors.ink, fontSize: 48, fontWeight: '800', textAlign: 'center' },
  label: { color: colors.muted, fontSize: 15, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', gap: sizes.gap, flexWrap: 'wrap' },
});
