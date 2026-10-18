/**
 * App TPV. Estats:
 *  1. Sense vincular → PairScreen
 *  2. Vinculat, sense operador → OperatorScreen
 *  3. Operador amb sessió → SellScreen (barra/cuina) o BoxOfficeScreen (taquilla)
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { OperatorSession, TerminalContext } from '@cashless/shared';
import { ApiRequestError, TpvApi } from './api';
import { BigButton, Screen, styles as ui } from './components';
import { BoxOfficeScreen } from './screens/BoxOfficeScreen';
import { OperatorScreen } from './screens/OperatorScreen';
import { PairScreen } from './screens/PairScreen';
import { SellScreen } from './screens/SellScreen';
import { clearTerminal, loadTerminal } from './storage';
import { colors } from './theme';

type State =
  | { stage: 'loading' }
  | { stage: 'error'; message: string; api: TpvApi }
  | { stage: 'unpaired' }
  | { stage: 'paired'; api: TpvApi; context: TerminalContext; session: OperatorSession | null };

export default function App() {
  const [state, setState] = useState<State>({ stage: 'loading' });

  const connect = useCallback(async (api: TpvApi) => {
    try {
      const context = await api.context();
      setState({ stage: 'paired', api, context, session: null });
    } catch (e) {
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
      else await connect(new TpvApi(stored.apiUrl, stored.terminalToken));
    })();
  }, [connect]);

  const logout = () => {
    if (state.stage !== 'paired') return;
    state.api.logout();
    void connect(state.api);
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
          onLogin={(session) => setState({ ...state, session })}
          onRefresh={() => connect(state.api)}
          onUnpair={() => {
            void clearTerminal().then(() => setState({ stage: 'unpaired' }));
          }}
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
