/** Dades del terminal desades de forma segura al dispositiu. */
import * as SecureStore from 'expo-secure-store';
import type { OperatorSession } from '@cashless/shared';

const KEYS = {
  apiUrl: 'cashless.apiUrl',
  terminalToken: 'cashless.terminalToken',
  session: 'cashless.operatorSession',
};

export interface StoredTerminal {
  apiUrl: string;
  terminalToken: string;
}

export async function loadTerminal(): Promise<StoredTerminal | null> {
  const [apiUrl, terminalToken] = await Promise.all([SecureStore.getItemAsync(KEYS.apiUrl), SecureStore.getItemAsync(KEYS.terminalToken)]);
  return apiUrl && terminalToken ? { apiUrl, terminalToken } : null;
}

export async function saveTerminal(value: StoredTerminal): Promise<void> {
  await SecureStore.setItemAsync(KEYS.apiUrl, value.apiUrl);
  await SecureStore.setItemAsync(KEYS.terminalToken, value.terminalToken);
}

export async function clearTerminal(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.apiUrl);
  await SecureStore.deleteItemAsync(KEYS.terminalToken);
  await clearSession();
}

/**
 * La sessió de l'operador es desa perquè, si el mòbil es reinicia durant un tall de xarxa,
 * es pugui continuar venent sense tornar a entrar el PIN (que necessita connexió).
 */
export async function saveSession(session: OperatorSession): Promise<void> {
  await SecureStore.setItemAsync(KEYS.session, JSON.stringify(session)).catch(() => undefined);
}

export async function loadSession(): Promise<OperatorSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.session);
    const session = raw ? (JSON.parse(raw) as OperatorSession) : null;
    return session && new Date(session.expiresAt) > new Date() ? session : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.session).catch(() => undefined);
}
