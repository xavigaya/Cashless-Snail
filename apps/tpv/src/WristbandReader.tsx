/**
 * Finestra que espera una polsera: per NFC (automàticament), per QR amb la càmera
 * o escrivint el codi imprès a mà.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { isValidCode, normalizeCode, parseWristbandQr, type WristbandRef } from '@cashless/shared';
import { BigButton, ErrorText, Screen, styles as ui } from './components';
import { cancelNfcRead, nfcEnabled, readWristbandUid } from './nfc';
import { colors, sizes } from './theme';

type Mode = 'nfc' | 'qr' | 'manual';

export function WristbandReader({
  visible,
  title,
  subtitle,
  onRead,
  onCancel,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onRead: (ref: WristbandRef) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>('nfc');
  const [nfcReady, setNfcReady] = useState<boolean | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  // Cada vegada que s'obre, es comença llegint per NFC (si el mòbil en té).
  useEffect(() => {
    if (!visible) return;
    done.current = false;
    setError(null);
    setManual('');
    let cancelled = false;
    void (async () => {
      const enabled = await nfcEnabled();
      if (cancelled) return;
      setNfcReady(enabled);
      setMode(enabled ? 'nfc' : 'qr');
    })();
    return () => {
      cancelled = true;
      void cancelNfcRead();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || mode !== 'nfc' || !nfcReady) return;
    let active = true;
    const loop = async () => {
      while (active && !done.current) {
        const uid = await readWristbandUid();
        if (!active || done.current) return;
        if (uid) {
          finish({ uid });
          return;
        }
      }
    };
    void loop();
    return () => {
      active = false;
      void cancelNfcRead();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, nfcReady]);

  function finish(ref: WristbandRef) {
    if (done.current) return;
    done.current = true;
    void cancelNfcRead();
    onRead(ref);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <Screen>
        <View style={local.body}>
          <Text style={ui.title}>{title}</Text>
          {subtitle ? <Text style={[ui.text, { marginTop: 6 }]}>{subtitle}</Text> : null}

          {mode === 'nfc' && (
            <View style={local.nfc}>
              <Text style={local.nfcIcon}>◉</Text>
              <Text style={[ui.text, { textAlign: 'center' }]}>Apropa la polsera a la part de darrere del mòbil</Text>
            </View>
          )}

          {mode === 'qr' && (
            <View style={local.camera}>
              {permission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => {
                    const code = parseWristbandQr(data);
                    if (code) finish({ code });
                    else setError('Aquest QR no és d’una polsera');
                  }}
                />
              ) : (
                <View style={{ gap: 12, padding: 16 }}>
                  <Text style={[ui.text, { textAlign: 'center' }]}>Cal permís per fer servir la càmera</Text>
                  <BigButton label="Permet la càmera" tone="accent" onPress={() => void requestPermission()} />
                </View>
              )}
            </View>
          )}

          {mode === 'manual' && (
            <View style={{ gap: 12, marginTop: 24 }}>
              <TextInput
                value={manual}
                onChangeText={setManual}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABCDE-FGHJK"
                placeholderTextColor={colors.muted}
                style={local.input}
              />
              <BigButton
                label="Fet"
                tone="accent"
                onPress={() => {
                  const code = normalizeCode(manual);
                  if (isValidCode(code)) finish({ code });
                  else setError('El codi ha de tenir 10 caràcters');
                }}
              />
            </View>
          )}

          <ErrorText message={error} />

          <View style={local.modes}>
            {nfcReady && mode !== 'nfc' && <BigButton label="NFC" onPress={() => setMode('nfc')} style={{ flex: 1 }} />}
            {mode !== 'qr' && <BigButton label="Escaneja QR" onPress={() => setMode('qr')} style={{ flex: 1 }} />}
            {mode !== 'manual' && <BigButton label="Escriu el codi" onPress={() => setMode('manual')} style={{ flex: 1 }} />}
          </View>
          <BigButton label="Cancel·la" tone="ghost" onPress={onCancel} style={{ marginTop: sizes.gap }} />
        </View>
      </Screen>
    </Modal>
  );
}

const local = StyleSheet.create({
  body: { flex: 1, padding: 20 },
  nfc: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  nfcIcon: { fontSize: 120, color: colors.accent },
  camera: { flex: 1, marginTop: 20, borderRadius: sizes.radius, overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'center' },
  modes: { flexDirection: 'row', gap: sizes.gap, marginTop: 16 },
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 28,
    letterSpacing: 3,
    textAlign: 'center',
    borderRadius: sizes.radius,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
  },
});
