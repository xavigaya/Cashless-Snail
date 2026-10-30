/**
 * Taquilla: activar polseres i recarregar saldo.
 * Flux: llegir la polsera → (activar-la si és nova) → triar import i forma de pagament → recarregar.
 *
 * Tot el que es cobra va dins d'un torn de caixa: l'operador l'obre amb el fons de canvi
 * i el tanca declarant l'efectiu comptat. Si troba obert el torn d'un company, el tanca ell (relleu).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatCode, formatEuros, type Balance, type CashShift, type OperatorSession, type TerminalContext, type WristbandRef } from '@cashless/shared';
import { ApiRequestError, newOperationId, type TpvApi } from '../api';
import { BigButton, ErrorText, Header, NumberPad, ResultOverlay, Screen, styles as ui, type ResultState } from '../components';
import { errorResult } from '../feedback';
import { colors, sizes } from '../theme';
import { WristbandReader } from '../WristbandReader';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

type Current = { ref: WristbandRef; balance: Balance } | { ref: WristbandRef; balance: null };

type ShiftState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }
  | { kind: 'mine'; shift: CashShift }
  | { kind: 'other'; shift: CashShift }
  | { kind: 'closing'; shift: CashShift };

const time = (iso: string) => new Date(iso).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });

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

  const [shift, setShift] = useState<ShiftState>({ kind: 'loading' });

  const loadShift = useCallback(async () => {
    try {
      const open = await api.currentShift();
      if (!open) setShift({ kind: 'none' });
      else setShift({ kind: open.operatorId === session.operator.id ? 'mine' : 'other', shift: open });
    } catch (e) {
      setShift({ kind: 'error', message: e instanceof Error ? e.message : 'No s’ha pogut consultar la caixa' });
    }
  }, [api, session.operator.id]);

  useEffect(() => {
    void loadShift();
  }, [loadShift]);

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
      // El torn s'ha tancat (p. ex. des del backoffice): es torna a la pantalla de caixa.
      if (e instanceof ApiRequestError && e.error.code === 'SHIFT_NOT_OPEN') void loadShift();
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
        if (current!.balance && current!.balance.debtCents > 0) {
          setResult({
            ok: true,
            title: `+${formatEuros(effectiveAmount)}`,
            detail: `Cobra ${formatEuros(effectiveAmount)} en ${method === 'cash' ? 'efectiu' : 'targeta'} · s’ha pagat un deute de ${formatEuros(current!.balance.debtCents)} · saldo ${formatEuros(res.balance.availableCents)}`,
          });
          return;
        }
        setResult({
          ok: true,
          title: `+${formatEuros(effectiveAmount)}`,
          detail: `Cobra ${formatEuros(effectiveAmount)} en ${method === 'cash' ? 'efectiu' : 'targeta'} · saldo ${formatEuros(res.balance.availableCents)}`,
        });
      },
      'No s’ha pogut recarregar',
    );

  if (shift.kind !== 'mine') {
    return (
      <ShiftGate
        api={api}
        context={context}
        session={session}
        state={shift}
        onChanged={(next) => setShift(next)}
        onRetry={() => void loadShift()}
        onLogout={onLogout}
      />
    );
  }

  return (
    <Screen>
      <Header
        title={context.pointOfSale.name}
        subtitle={`${session.operator.name} · caixa oberta a les ${time(shift.shift.openedAt)}`}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <BigButton label="Tanca caixa" tone="ghost" onPress={() => setShift({ kind: 'closing', shift: shift.shift })} style={local.headerButton} />
            <BigButton label="Surt" tone="ghost" onPress={onLogout} style={local.headerButton} />
          </View>
        }
      />
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
                  {current.balance.debtCents > 0 && (
                    <Text style={[ui.text, { color: colors.warn, textAlign: 'center' }]}>
                      Deute de {formatEuros(current.balance.debtCents)} d’una venda sense connexió: la recàrrega primer el paga
                    </Text>
                  )}
                  {!current.balance.activatedInEvent && (
                    <Text style={[ui.text, { color: colors.warn, textAlign: 'center' }]}>
                      No està activada en aquest esdeveniment: cal activar-la ({formatEuros(price + deposit)}) per recarregar i comprar
                    </Text>
                  )}
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

            {!current.balance || !current.balance.activatedInEvent ? (
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

/**
 * Obrir caixa (fons de canvi), tancar la pròpia (efectiu comptat) o fer el relleu d'un company.
 * L'efectiu esperat no es mostra fins després de declarar el comptat, perquè el recompte sigui a cegues.
 */
function ShiftGate({
  api,
  context,
  session,
  state,
  onChanged,
  onRetry,
  onLogout,
}: {
  api: TpvApi;
  context: TerminalContext;
  session: OperatorSession;
  state: Exclude<ShiftState, { kind: 'mine' }>;
  onChanged: (next: ShiftState) => void;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [after, setAfter] = useState<ShiftState | 'logout' | null>(null);
  const openId = useRef<string | null>(null);
  const cents = Number(digits || '0');

  async function open() {
    setBusy(true);
    setError(null);
    openId.current ??= newOperationId();
    try {
      const shift = await api.openShift(openId.current, cents);
      openId.current = null;
      onChanged({ kind: shift.operatorId === session.operator.id ? 'mine' : 'other', shift });
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.isNetwork)) openId.current = null;
      setError(e instanceof Error ? e.message : 'No s’ha pogut obrir la caixa');
    } finally {
      setBusy(false);
    }
  }

  async function close(shift: CashShift) {
    setBusy(true);
    setError(null);
    try {
      const closed = await api.closeShift(shift.id, cents);
      const diff = closed.differenceCents ?? 0;
      setDigits('');
      setAfter(shift.operatorId === session.operator.id ? 'logout' : { kind: 'none' });
      setResult({
        ok: diff === 0,
        warn: diff !== 0,
        title: diff === 0 ? 'Caixa quadrada' : diff > 0 ? `Sobren ${formatEuros(diff)}` : `Falten ${formatEuros(-diff)}`,
        detail: `Esperat ${formatEuros(closed.expectedCashCents)} · comptat ${formatEuros(closed.declaredCashCents ?? 0)} · targeta ${formatEuros(closed.cardCents)}`,
      });
    } catch (e) {
      if (e instanceof ApiRequestError && e.error.code === 'SHIFT_CLOSED') onChanged({ kind: 'none' });
      setError(e instanceof Error ? e.message : 'No s’ha pogut tancar la caixa');
    } finally {
      setBusy(false);
    }
  }

  const pad = (
    <>
      <Text style={[local.balance, { fontSize: 44, marginVertical: 12 }]}>{formatEuros(cents)}</Text>
      <NumberPad
        onDigit={(d) => setDigits((v) => (v + d).replace(/^0+/, '').slice(0, 7))}
        onDelete={() => setDigits((v) => v.slice(0, -1))}
        onClear={() => setDigits('')}
      />
    </>
  );

  return (
    <Screen>
      <Header
        title={context.pointOfSale.name}
        subtitle={session.operator.name}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {state.kind === 'closing' && (
              <BigButton label="Enrere" tone="ghost" onPress={() => onChanged({ kind: 'mine', shift: state.shift })} style={local.headerButton} />
            )}
            <BigButton label="Surt" tone="ghost" onPress={onLogout} style={local.headerButton} />
          </View>
        }
      />
      <ScrollView contentContainerStyle={local.body}>
        {state.kind === 'loading' && <Text style={[ui.muted, { textAlign: 'center' }]}>Consultant la caixa…</Text>}

        {state.kind === 'error' && (
          <View style={local.start}>
            <Text style={ui.error}>{state.message}</Text>
            <BigButton label="Torna-ho a provar" tone="accent" onPress={onRetry} />
          </View>
        )}

        {state.kind === 'none' && (
          <>
            <Text style={[ui.title, { textAlign: 'center' }]}>Obre la caixa</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>Compta el fons de canvi que hi ha al calaix (en cèntims: 5000 = 50,00 €).</Text>
            {pad}
            <BigButton label={`Obre amb ${formatEuros(cents)}`} tone="accent" busy={busy} onPress={() => void open()} style={{ marginTop: 20, minHeight: 80 }} />
          </>
        )}

        {(state.kind === 'other' || state.kind === 'closing') && (
          <>
            <Text style={[ui.title, { textAlign: 'center' }]}>{state.kind === 'closing' ? 'Tanca la caixa' : 'Relleu de caixa'}</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>
              {state.kind === 'other'
                ? `La caixa té obert el torn de ${state.shift.operatorName} (des de les ${time(state.shift.openedAt)}). Compta tot l’efectiu del calaix i tanca el seu torn per obrir el teu.`
                : 'Compta tot l’efectiu del calaix, inclòs el fons de canvi (en cèntims: 12345 = 123,45 €).'}
            </Text>
            {pad}
            <BigButton
              label={`Tanca amb ${formatEuros(cents)} comptats`}
              tone="accent"
              busy={busy}
              onPress={() => void close(state.shift)}
              style={{ marginTop: 20, minHeight: 80 }}
            />
          </>
        )}
        <ErrorText message={error} />
      </ScrollView>
      <ResultOverlay
        result={result}
        onDismiss={() => {
          setResult(null);
          if (after === 'logout') onLogout();
          else if (after) onChanged(after);
          setAfter(null);
        }}
      />
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
