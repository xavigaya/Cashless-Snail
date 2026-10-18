/**
 * Venda a barra o cuina: botons grans de producte, cistella i cobrament amb polsera.
 * Objectiu: tres tocs per venda (producte → Cobra → apropar la polsera).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { formatEuros, MOVEMENT_TYPE_LABELS, type Movement, type OperatorSession, type Product, type TerminalContext, type WristbandRef } from '@cashless/shared';
import { ApiRequestError, newOperationId, type TpvApi } from '../api';
import { BigButton, ErrorText, Header, ResultOverlay, Screen, styles as ui, type ResultState } from '../components';
import { errorResult } from '../feedback';
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
  const pendingSaleId = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const columns = Math.max(2, Math.floor(width / 170));

  const load = useCallback(async () => {
    try {
      setProducts(await api.catalog());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'No s’ha pogut carregar el catàleg');
    }
  }, [api]);

  useEffect(() => {
    void load();
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
    pendingSaleId.current ??= newOperationId();
    try {
      const res = await api.sale(
        pendingSaleId.current,
        wristband,
        lines.map(([productId, quantity]) => ({ productId, quantity })),
      );
      pendingSaleId.current = null;
      setCart({});
      setResult({ ok: true, title: formatEuros(res.movement.amountCents), detail: `Saldo restant: ${formatEuros(res.balance.availableCents)}` });
    } catch (e) {
      // Si l'error és de xarxa, potser el servidor sí que l'ha registrada: es manté l'identificador
      // perquè el reintent no la dupliqui. Si el servidor l'ha rebutjada, se'n farà servir un de nou.
      if (!(e instanceof ApiRequestError && e.isNetwork)) pendingSaleId.current = null;
      setResult(errorResult(e, 'No s’ha pogut cobrar'));
    } finally {
      setBusy(false);
    }
  }

  async function checkBalance(wristband: WristbandRef) {
    setReading(null);
    try {
      const balance = await api.balance(wristband);
      setResult({ ok: balance.status === 'active', title: formatEuros(balance.availableCents), detail: balance.status === 'active' ? 'Saldo disponible' : 'Polsera bloquejada' });
    } catch (e) {
      setResult(errorResult(e, 'No s’ha pogut consultar'));
    }
  }

  return (
    <Screen>
      <Header
        title={context.pointOfSale.name}
        subtitle={session.operator.name}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
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
      <ResultOverlay result={result} onDismiss={() => setResult(null)} />
    </Screen>
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
