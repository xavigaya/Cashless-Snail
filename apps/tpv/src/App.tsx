/**
 * App TPV. Estats:
 *  1. Sense vincular → PairScreen
 *  2. Vinculat, sense operador → OperatorScreen
 *  3. Operador amb sessió → SellScreen (barra/cuina) o BoxOfficeScreen (taquilla)
 *
 * Mentre el terminal està vinculat, les vendes fetes sense connexió s'envien cada pocs segons.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { OperatorSession, TerminalContext } from '@cashless/shared';
import { ApiRequestError, TpvApi } from './api';
import { BigButton, Screen, styles as ui } from './components';
import { BoxOfficeScreen } from './screens/BoxOfficeScreen';
import { OperatorScreen } from './screens/OperatorScreen';
import { PairScreen } from './screens/PairScreen';
import { SellScreen } from './screens/SellScreen';
import { clearTerminalCache, loadContext, offlineQueue, saveContext } from './offline';
import { clearSession, clearTerminal, loadSession, loadTerminal, saveSession } from './storage';
import { colors } from './theme';

type State =
  | { stage: 'loading' }
  | { stage: 'error'; message: string; api: TpvApi }
  | { stage: 'unpaired' }
  | { stage: 'paired'; api: TpvApi; context: TerminalContext; session: OperatorSession | null };

export default function App() {
  const [state, setState] = useState<State>({ stage: 'loading' });

  const connect = useCallback(async (api: TpvApi, resume = false) => {
    // Si el mòbil s'ha reiniciat, es recupera la sessió de l'operador (encara vàlida).
    const session = resume ? await loadSession() : null;
    if (session) api.operatorToken = session.token;
    try {
      const context = await api.context();
      await saveContext(context);
      setState({ stage: 'paired', api, context, session });
    } catch (e) {
      // Sense xarxa: es continua amb el context desat, per poder vendre sense connexió.
      if (e instanceof ApiRequestError && e.isNetwork) {
        const cached = await loadContext();
        if (cached) {
          setState({ stage: 'paired', api, context: cached, session });
          return;
        }
      }
      // Si el servidor diu que el terminal ja no és vàlid, cal tornar a vincular-lo.
      if (e instanceof ApiRequestError && (e.error.statusCode === 401 || e.error.code === 'TERMINAL_DISABLED')) {
        await clearTerminal();
        setState({ stage: 'unpaired' });
        return;
      }
      setState({ stage: 'error', message: e instanceof Error ? e.message : 'Error desconegut', api });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = await loadTerminal();
      if (!stored) setState({ stage: 'unpaired' });
      else await connect(new TpvApi(stored.apiUrl, stored.terminalToken), true);
    })();
  }, [connect]);

  // Envia les vendes pendents: periòdicament i quan l'app torna a primer pla.
  const pairedApi = state.stage === 'paired' ? state.api : null;
  useEffect(() => {
    if (!pairedApi) return;
    const sync = () => void offlineQueue.sync(pairedApi);
    sync();
    const timer = setInterval(sync, 15_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [pairedApi]);

  const logout = () => {
    if (state.stage !== 'paired') return;
    state.api.logout();
    void clearSession();
    void connect(state.api);
  };

  const unpair = () => {
    // Sense el token del terminal, les vendes pendents ja no es podrien enviar.
    if (offlineQueue.current.pending.length > 0) {
      Alert.alert('Hi ha vendes pendents', 'Aquest terminal té vendes fetes sense connexió que encara no s’han enviat. Connecta’l a internet abans de desvincular-lo.');
      return;
    }
    void Promise.all([clearTerminal(), clearTerminalCache()]).then(() => setState({ stage: 'unpaired' }));
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {state.stage === 'loading' && (
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}

      {state.stage === 'error' && (
        <Screen>
          <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
            <Text style={ui.title}>No es pot connectar</Text>
            <Text style={ui.text}>{state.message}</Text>
            <BigButton label="Torna-ho a provar" tone="accent" onPress={() => void connect(state.api)} />
          </View>
        </Screen>
      )}

      {state.stage === 'unpaired' && <PairScreen onPaired={(api, context) => setState({ stage: 'paired', api, context, session: null })} />}

      {state.stage === 'paired' && !state.session && (
        <OperatorScreen
          api={state.api}
          context={state.context}
          onLogin={(session) => {
            void saveSession(session);
            setState({ ...state, session });
          }}
          onRefresh={() => connect(state.api)}
          onUnpair={unpair}
        />
      )}

      {state.stage === 'paired' && state.session && state.context.pointOfSale.kind === 'box_office' && (
        <BoxOfficeScreen api={state.api} context={state.context} session={state.session} onLogout={logout} />
      )}

      {state.stage === 'paired' && state.session && state.context.pointOfSale.kind !== 'box_office' && (
        <SellScreen api={state.api} context={state.context} session={state.session} onLogout={logout} />
      )}
    </SafeAreaProvider>
  );
}
