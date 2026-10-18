/** Primera pantalla: vincular el dispositiu a un terminal escanejant el QR del backoffice. */
import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parsePairingQr, type TerminalContext } from '@cashless/shared';
import { TpvApi } from '../api';
import { BigButton, ErrorText, Screen, styles as ui } from '../components';
import { saveTerminal } from '../storage';
import { colors, sizes } from '../theme';

export function PairScreen({ onPaired }: { onPaired: (api: TpvApi, context: TerminalContext) => void }) {
  const [mode, setMode] = useState<'qr' | 'manual'>('qr');
  const [apiUrl, setApiUrl] = useState('https://');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // La càmera pot detectar el mateix QR diverses vegades seguides: només s'envia una petició.
  const pairing = useRef(false);

  async function pair(url: string, pairingCode: string) {
    if (pairing.current) return;
    pairing.current = true;
    setBusy(true);
    setError(null);
    try {
      const deviceName = `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} ${String(Platform.Version)}`;
      const result = await TpvApi.pair(url, pairingCode, deviceName);
      await saveTerminal({ apiUrl: url, terminalToken: result.terminalToken });
      onPaired(new TpvApi(url, result.terminalToken), result.context);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No s’ha pogut vincular');
      setBusy(false);
      pairing.current = false;
    }
  }

  return (
    <Screen>
      <View style={local.body}>
        <Text style={ui.title}>Vincula aquest terminal</Text>
        <Text style={[ui.muted, { marginTop: 6 }]}>
          Al backoffice, ves a l’esdeveniment → Operadors i terminals, i escaneja el QR del terminal.
        </Text>

        {mode === 'qr' ? (
          <View style={local.camera}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  const qr = parsePairingQr(data);
                  if (qr) void pair(qr.apiUrl, qr.code);
                  else setError('Aquest QR no és de vinculació');
                }}
              />
            ) : (
              <View style={{ padding: 16, gap: 12 }}>
                <Text style={[ui.text, { textAlign: 'center' }]}>Cal permís per fer servir la càmera</Text>
                <BigButton label="Permet la càmera" tone="accent" onPress={() => void requestPermission()} />
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Text style={ui.muted}>Adreça del servidor</Text>
            <TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={local.input} />
            <Text style={ui.muted}>Codi de vinculació</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="K7P2M9QX"
              placeholderTextColor={colors.muted}
              style={[local.input, local.code]}
            />
            <BigButton label="Vincula" tone="accent" busy={busy} onPress={() => void pair(apiUrl.trim(), code.trim())} />
          </View>
        )}

        <ErrorText message={error} />
        <BigButton
          label={mode === 'qr' ? 'Escriu el codi a mà' : 'Escaneja el QR'}
          tone="ghost"
          onPress={() => setMode(mode === 'qr' ? 'manual' : 'qr')}
          style={{ marginTop: sizes.gap }}
        />
      </View>
    </Screen>
  );
}

const local = StyleSheet.create({
  body: { flex: 1, padding: 20 },
  camera: { flex: 1, marginTop: 20, borderRadius: sizes.radius, overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'center' },
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 18,
    borderRadius: sizes.radius,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  code: { fontSize: 28, letterSpacing: 4, textAlign: 'center' },
});
