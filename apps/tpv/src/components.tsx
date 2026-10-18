/** Components bàsics de la interfície del terminal. */
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, sizes } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.muted} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

type Tone = 'accent' | 'neutral' | 'danger' | 'ghost';

export function BigButton({
  label,
  onPress,
  tone = 'neutral',
  disabled,
  busy,
  style,
  color,
  sublabel,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  color?: string;
  sublabel?: string;
}) {
  const background = color ?? { accent: colors.accent, neutral: colors.surfaceRaised, danger: colors.bad, ghost: 'transparent' }[tone];
  const ink = tone === 'accent' && !color ? colors.accentInk : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        tone === 'ghost' && styles.ghost,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          <Text style={[styles.buttonText, { color: ink }]} numberOfLines={2}>
            {label}
          </Text>
          {sublabel ? <Text style={[styles.buttonSub, { color: ink }]}>{sublabel}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

/** Teclat numèric per al PIN i per a imports. */
export function NumberPad({ onDigit, onDelete, onClear }: { onDigit: (d: string) => void; onDelete: () => void; onClear?: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  return (
    <View style={styles.pad}>
      {keys.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === '⌫' ? 'Esborra' : k === 'C' ? 'Neteja' : k}
          style={({ pressed }) => [styles.padKey, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            if (k === '⌫') onDelete();
            else if (k === 'C') onClear?.();
            else onDigit(k);
          }}
        >
          <Text style={styles.padText}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface ResultState {
  ok: boolean;
  title: string;
  detail?: string;
}

/** Pantalla completa verda o vermella amb el resultat d'una operació. */
export function ResultOverlay({ result, onDismiss }: { result: ResultState | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!result) return;
    void Haptics.notificationAsync(result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(
      () => undefined,
    );
    if (!result.ok) return;
    const timer = setTimeout(onDismiss, 2500);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (!result) return null;
  return (
    <Pressable style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: result.ok ? colors.ok : colors.bad }]} onPress={onDismiss}>
      <Text style={styles.overlayIcon}>{result.ok ? '✓' : '✕'}</Text>
      <Text style={styles.overlayTitle}>{result.title}</Text>
      {result.detail ? <Text style={styles.overlayDetail}>{result.detail}</Text> : null}
      <Text style={styles.overlayHint}>Toca per continuar</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sizes.gap,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 15 },
  text: { color: colors.ink, fontSize: sizes.text },
  title: { color: colors.ink, fontSize: sizes.title, fontWeight: '700' },
  button: {
    minHeight: sizes.touch,
    borderRadius: sizes.radius,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: sizes.text, fontWeight: '700', textAlign: 'center' },
  buttonSub: { fontSize: 15, marginTop: 2, opacity: 0.9 },
  error: { color: colors.bad, fontSize: 16, marginVertical: 8, textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 360, alignSelf: 'center' },
  padKey: {
    width: 100,
    height: 72,
    borderRadius: sizes.radius,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padText: { color: colors.ink, fontSize: 28, fontWeight: '600' },
  overlay: { alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 10 },
  overlayIcon: { color: '#fff', fontSize: 110, fontWeight: '800' },
  overlayTitle: { color: '#fff', fontSize: sizes.huge, fontWeight: '800', textAlign: 'center' },
  overlayDetail: { color: '#fff', fontSize: 22, marginTop: 12, textAlign: 'center' },
  overlayHint: { color: '#fff', opacity: 0.8, marginTop: 40, fontSize: 16 },
});
