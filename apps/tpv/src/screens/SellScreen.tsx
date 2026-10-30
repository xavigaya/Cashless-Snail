/**
 * Venda a barra o cuina: botons grans de producte, cistella i cobrament amb polsera.
 * Objectiu: tres tocs per venda (producte → Cobra → apropar la polsera).
 *
 * Sense connexió es pot continuar cobrant fins al límit de l'esdeveniment (vegeu offline.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { formatEuros, MOVEMENT_TYPE_LABELS, type Movement, type OperatorSession, type Product, type TerminalContext, type WristbandRef } from '@cashless/shared';
import { ApiRequestError, newOperationId, type TpvApi } from '../api';
import { BigButton, ErrorText, Header, ResultOverlay, Screen, styles as ui, type ResultState } from '../components';
import { errorResult } from '../feedback';
import { loadCatalog, offlineQueue, saveCatalog, wristbandKey, type QueueState } from '../offline';
import { colors, sizes } from '../theme';
import { WristbandReader } from '../WristbandReader';

type Reading = { purpose: 'sale' } | { purpose: 'balance' };

export function SellScreen({ api, context, session, onLogout }: { api: TpvApi; context: TerminalContext; session: OperatorSession; onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [showVoids, setShowVoids] = useState(false);
  // L'identificador es manté si es reintenta la mateixa venda, perquè el servidor no la dupliqui.
  // Només es reutilitza si es repeteix exactament la mateixa venda (mateixa polsera i cistella).
  const pendingSaleId = useRef<{ key: string; id: string } | null>(null);
  const { width } = useWindowDimensions();
  const columns = Math.max(2, Math.floor(width / 170));

  const [queue, setQueue] = useState<QueueState>(offlineQueue.current);
  const [showRejected, setShowRejected] = useState(false);
  const offlineLimit = context.event.offlineSaleLimitCents;

  const load = useCallback(async () => {
    try {
      const list = await api.catalog();
      setProducts(list);
      void saveCatalog(list);
      setLoadError(null);
    } catch (e) {
      const cached = e instanceof ApiRequestError && e.isNetwork ? await loadCatalog() : null;
      if (cached) {
        setProducts(cached);
        setLoadError(null);
      } else {
        setLoadError(e instanceof Error ? e.message : 'No s’ha pogut carregar el catàleg');
      }
    }
  }, [api]);

  useEffect(() => {
    void load();
    void offlineQueue.load();
    return offlineQueue.subscribe(setQueue);
  }, [load]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const total = lines.reduce((sum, [id, q]) => sum + (byId.get(id)?.priceCents ?? 0) * q, 0);

  const add = (id: string) => {
    pendingSaleId.current = null;
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  };
  const clear = () => {
    pendingSaleId.current = null;
    setCart({});
  };

  async function charge(wristband: WristbandRef) {
    setReading(null);
    setBusy(true);
    const key = `${wristbandKey(wristband)}|${JSON.stringify(lines)}`;
    if (pendingSaleId.current?.key !== key) pendingSaleId.current = { key, id: newOperationId() };
    const saleId = pendingSaleId.current.id;
    try {
      const res = await api.sale(
        saleId,
        wristband,
        lines.map(([productId, quantity]) => ({ productId, quantity })),
      );
      pendingSaleId.current = null;
      setCart({});
      setResult({ ok: true, title: formatEuros(res.movement.amountCents), detail: `Saldo restant: ${formatEuros(res.balance.availableCents)}` });
      // Hi ha connexió: és un bon moment per enviar les vendes pendents.
      void offlineQueue.sync(api, context.terminal.id);
    } catch (e) {
      if (e instanceof ApiRequestError && e.isNetwork) {
        await chargeOffline(wristband, saleId);
        return;
      }
      // El servidor l'ha rebutjada: el proper intent farà servir un identificador nou.
      pendingSaleId.current = null;
      setResult(errorResult(e, 'No s’ha pogut cobrar'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sense connexió: es cobra igualment si no se supera el límit (per venda i per polsera en aquest terminal).
   * Es fa servir el mateix identificador: si la venda sí que havia arribat al servidor, no es duplicarà.
   */
  async function chargeOffline(wristband: WristbandRef, id: string) {
    const pendingForWristband = offlineQueue.pendingFor(wristband);
    if (offlineLimit <= 0 || total > offlineLimit || pendingForWristband + total > offlineLimit) {
      setResult({
        ok: false,
        title: 'Sense connexió',
        detail:
          offlineLimit <= 0
            ? 'En aquest esdeveniment no es pot cobrar sense connexió.'
            : `Sense connexió només es pot cobrar fins a ${formatEuros(offlineLimit)} per polsera` +
              (pendingForWristband > 0 ? ` (aquesta ja té ${formatEuros(pendingForWristband)} pendents)` : '') +
              '. Torna-ho a provar.',
      });
      return;
    }
    await offlineQueue.add({
      id,
      terminalId: context.terminal.id,
      wristband,
      operatorId: session.operator.id,
      lines: lines.map(([productId, quantity]) => ({ productId, quantity, unitPriceCents: byId.get(productId)?.priceCents ?? 0 })),
      totalCents: total,
      clientCreatedAt: new Date().toISOString(),
    });
    pendingSaleId.current = null;
    setCart({});
    setResult({ ok: true, warn: true, title: formatEuros(total), detail: 'Cobrat sense connexió. S’enviarà quan torni la xarxa.' });
  }

  async function checkBalance(wristband: WristbandRef) {
    setReading(null);
    try {
      const balance = await api.balance(wristband);
      const pending = offlineQueue.pendingFor(wristband);
      setResult({
        ok: balance.status === 'active' && balance.debtCents === 0,
        title: balance.debtCents > 0 ? `Deute ${formatEuros(balance.debtCents)}` : formatEuros(balance.availableCents),
        detail:
          balance.status !== 'active'
            ? 'Polsera bloquejada'
            : balance.debtCents > 0
              ? 'Cal recarregar a la taquilla'
              : pending > 0
                ? `Saldo disponible (falten ${formatEuros(pending)} de vendes pendents d’enviar)`
                : 'Saldo disponible',
      });
    } catch (e) {
      setResult(errorResult(e, 'No s’ha pogut consultar'));
    }
  }

  return (
    <Screen>
      <Header
        title={context.pointOfSale.name}
        subtitle={
          queue.pending.length > 0
            ? `${session.operator.name} · ${queue.pending.length} ${queue.pending.length === 1 ? 'venda pendent' : 'vendes pendents'} d’enviar`
            : session.operator.name
        }
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {queue.rejected.length > 0 && (
              <BigButton label={`⚠ ${queue.rejected.length}`} tone="danger" onPress={() => setShowRejected(true)} style={local.headerButton} />
            )}
            {session.operator.role === 'bar_lead' && <BigButton label="Anul·la" tone="ghost" onPress={() => setShowVoids(true)} style={local.headerButton} />}
            <BigButton label="Saldo" tone="ghost" onPress={() => setReading({ purpose: 'balance' })} style={local.headerButton} />
            <BigButton label="Surt" tone="ghost" onPress={onLogout} style={local.headerButton} />
          </View>
        }
      />

      <ErrorText message={loadError} />
      <FlatList
        key={columns}
        data={products}
        numColumns={columns}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: sizes.gap, gap: sizes.gap }}
        columnWrapperStyle={{ gap: sizes.gap }}
        onRefresh={() => void load()}
        refreshing={false}
        ListEmptyComponent={!loadError ? <Text style={[ui.muted, { padding: 20 }]}>No hi ha productes en aquest punt de venda.</Text> : null}
        renderItem={({ item }) => {
          const qty = cart[item.id] ?? 0;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${formatEuros(item.priceCents)}`}
              onPress={() => add(item.id)}
              style={({ pressed }) => [local.product, { backgroundColor: item.color, opacity: pressed ? 0.75 : 1 }]}
            >
              <Text style={local.productName} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={local.productPrice}>{formatEuros(item.priceCents)}</Text>
              {qty > 0 && (
                <View style={local.qty}>
                  <Text style={local.qtyText}>{qty}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />

      <View style={local.cart}>
        <View style={{ flex: 1 }}>
          <Text style={ui.muted} numberOfLines={2}>
            {lines.length === 0 ? 'Toca els productes per afegir-los' : lines.map(([id, q]) => `${q}× ${byId.get(id)?.name ?? ''}`).join(', ')}
          </Text>
          <Text style={local.total}>{formatEuros(total)}</Text>
        </View>
        <BigButton label="Esborra" tone="ghost" onPress={clear} disabled={lines.length === 0} style={{ minWidth: 96 }} />
        <BigButton label="Cobra" tone="accent" onPress={() => setReading({ purpose: 'sale' })} disabled={lines.length === 0} busy={busy} style={{ minWidth: 130 }} />
      </View>

      <WristbandReader
        visible={reading !== null}
        title={reading?.purpose === 'sale' ? `Cobrar ${formatEuros(total)}` : 'Consulta de saldo'}
        onCancel={() => setReading(null)}
        onRead={(ref) => void (reading?.purpose === 'sale' ? charge(ref) : checkBalance(ref))}
      />

      {showVoids && <VoidsModal api={api} onClose={() => setShowVoids(false)} onResult={setResult} />}
      {showRejected && <RejectedModal queue={queue} onClose={() => setShowRejected(false)} />}
      <ResultOverlay result={result} onDismiss={() => setResult(null)} />
    </Screen>
  );
}

/** Vendes sense connexió que el servidor no ha acceptat: s'han de comunicar a l'organització. */
function RejectedModal({ queue, onClose }: { queue: QueueState; onClose: () => void }) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Header title="Vendes no acceptades" right={<BigButton label="Tanca" tone="ghost" onPress={onClose} style={local.headerButton} />} />
        <Text style={[ui.muted, { padding: 16 }]}>
          Aquestes vendes es van cobrar sense connexió però el servidor no les ha acceptat. Fes una foto d’aquesta pantalla i
          passa-la a l’organització.
        </Text>
        <FlatList
          data={queue.rejected}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={local.row}>
              <View style={{ flex: 1 }}>
                <Text style={ui.text}>
                  {formatEuros(item.totalCents)} · {new Date(item.clientCreatedAt).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={ui.muted}>{item.message}</Text>
                <Text style={ui.muted}>Polsera {item.wristband.uid ?? item.wristband.code}</Text>
              </View>
            </View>
          )}
        />
        <View style={{ padding: 16 }}>
          <BigButton
            label="Ja ho he comunicat: esborra la llista"
            tone="ghost"
            onPress={() => {
              void offlineQueue.clearRejected().then(onClose);
            }}
          />
        </View>
      </Screen>
    </Modal>
  );
}

/** Llista de les últimes vendes d'aquest terminal perquè el cap de barra en pugui anul·lar una. */
function VoidsModal({ api, onClose, onResult }: { api: TpvApi; onClose: () => void; onResult: (r: ResultState) => void }) {
  const [items, setItems] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .recent()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [api]);

  async function voidSale(m: Movement) {
    setBusyId(m.id);
    try {
      const res = await api.void(newOperationId(), m.id, 'Anul·lada pel cap de barra');
      onClose();
      onResult({ ok: true, title: 'Venda anul·lada', detail: `Retornats ${formatEuros(m.amountCents)} · saldo ${formatEuros(res.balance.availableCents)}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No s’ha pogut anul·lar');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Header title="Últimes operacions" right={<BigButton label="Tanca" tone="ghost" onPress={onClose} style={local.headerButton} />} />
        <ErrorText message={error} />
        <FlatList
          data={items ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<Text style={ui.muted}>{items ? 'Encara no hi ha operacions.' : 'Carregant…'}</Text>}
          renderItem={({ item }) => {
            const canVoid = item.type === 'sale' && !item.voidedByMovementId;
            return (
              <View style={local.row}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text}>
                    {MOVEMENT_TYPE_LABELS[item.type]} · {formatEuros(item.amountCents)}
                    {item.voidedByMovementId ? ' · anul·lada' : ''}
                  </Text>
                  <Text style={ui.muted} numberOfLines={1}>
                    {new Date(item.createdAt).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {item.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
                  </Text>
                </View>
                {canVoid && <BigButton label="Anul·la" tone="danger" busy={busyId === item.id} onPress={() => void voidSale(item)} style={{ minWidth: 110 }} />}
              </View>
            );
          }}
        />
      </Screen>
    </Modal>
  );
}

const local = StyleSheet.create({
  headerButton: { minHeight: 44, paddingHorizontal: 12 },
  product: {
    flex: 1,
    minHeight: 110,
    borderRadius: sizes.radius,
    padding: 12,
    justifyContent: 'space-between',
  },
  productName: { color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 },
  productPrice: { color: '#fff', fontSize: 18, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 },
  qty: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  qtyText: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  cart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sizes.gap,
    padding: sizes.gap,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  total: { color: colors.ink, fontSize: 30, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: sizes.radius, padding: 12 },
});
