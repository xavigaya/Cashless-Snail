/** Tria d'operador i entrada amb PIN. */
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { OPERATOR_ROLE_LABELS, POS_KIND_LABELS, type OperatorSession, type TerminalContext } from '@cashless/shared';
import type { TpvApi } from '../api';
import { BigButton, ErrorText, Header, NumberPad, Screen, styles as ui } from '../components';
import { colors, sizes } from '../theme';

export function OperatorScreen({
  api,
  context,
  onLogin,
  onRefresh,
  onUnpair,
}: {
  api: TpvApi;
  context: TerminalContext;
  onLogin: (session: OperatorSession) => void;
  onRefresh: () => Promise<void>;
  onUnpair: () => void;
}) {
  const [selected, setSelected] = useState<TerminalContext['operators'][number] | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(selected.id, value));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No s’ha pogut entrar');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <Header
      title={context.terminal.name}
      subtitle={`${context.event.name} · ${context.pointOfSale.name} (${POS_KIND_LABELS[context.pointOfSale.kind]})`}
    />
  );

  if (!selected) {
    return (
      <Screen>
        {header}
        <View style={local.body}>
          <Text style={ui.title}>Qui ets?</Text>
          {context.event.status !== 'active' && <Text style={[ui.error, { textAlign: 'left' }]}>L’esdeveniment no està actiu: encara no es pot operar.</Text>}
          <FlatList
            data={context.operators}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ gap: sizes.gap, paddingVertical: 16 }}
            ListEmptyComponent={<Text style={ui.muted}>No hi ha operadors per a aquest punt de venda. Afegeix-ne al backoffice.</Text>}
            renderItem={({ item }) => (
              <BigButton label={item.name} sublabel={OPERATOR_ROLE_LABELS[item.role]} onPress={() => setSelected(item)} />
            )}
          />
          <View style={{ flexDirection: 'row', gap: sizes.gap }}>
            <BigButton label="Actualitza" tone="ghost" style={{ flex: 1 }} onPress={() => void onRefresh()} />
            <BigButton
              label="Desvincula"
              tone="ghost"
              style={{ flex: 1 }}
              onPress={() =>
                Alert.alert('Desvincular el terminal', 'Caldrà tornar a escanejar un QR de vinculació. Vols continuar?', [
                  { text: 'Cancel·la', style: 'cancel' },
                  { text: 'Desvincula', style: 'destructive', onPress: onUnpair },
                ])
              }
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <View style={[local.body, { justifyContent: 'center' }]}>
        <Text style={[ui.title, { textAlign: 'center' }]}>{selected.name}</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginTop: 4 }]}>Escriu el teu PIN</Text>
        <View style={local.dots}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[local.dot, i < pin.length && local.dotFilled]} />
          ))}
        </View>
        <ErrorText message={error} />
        <NumberPad
          onDigit={(d) => {
            if (pin.length >= 6) return;
            setPin(pin + d);
          }}
          onDelete={() => setPin(pin.slice(0, -1))}
          onClear={() => setPin('')}
        />
        <View style={{ flexDirection: 'row', gap: sizes.gap, marginTop: 20 }}>
          <BigButton
            label="Enrere"
            tone="ghost"
            style={{ flex: 1 }}
            onPress={() => {
              setSelected(null);
              setPin('');
              setError(null);
            }}
          />
          <BigButton label="Entra" tone="accent" style={{ flex: 1 }} busy={busy} disabled={pin.length < 4} onPress={() => void submit(pin)} />
        </View>
      </View>
    </Screen>
  );
}

const local = StyleSheet.create({
  body: { flex: 1, padding: 20 },
  dots: { flexDirection: 'row', gap: 14, justifyContent: 'center', marginVertical: 20 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.muted },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
});
