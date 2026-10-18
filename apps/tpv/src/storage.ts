/** Dades del terminal desades de forma segura al dispositiu. */
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  apiUrl: 'cashless.apiUrl',
  terminalToken: 'cashless.terminalToken',
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
}
