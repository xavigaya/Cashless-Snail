/**
 * Lectura de polseres NFC. Només es fa servir l'identificador (UID) del xip:
 * el saldo és al servidor.
 * Cal una "development build" d'Expo (no funciona dins d'Expo Go).
 */
import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { isValidUid, normalizeUid } from '@cashless/shared';

let started: Promise<boolean> | null = null;

export function nfcAvailable(): Promise<boolean> {
  started ??= (async () => {
    try {
      if (!(await NfcManager.isSupported())) return false;
      await NfcManager.start();
      return true;
    } catch {
      return false;
    }
  })();
  return started;
}

export async function nfcEnabled(): Promise<boolean> {
  if (!(await nfcAvailable())) return false;
  // A iOS el NFC sempre està "activat" si el dispositiu el suporta.
  if (Platform.OS === 'ios') return true;
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

/**
 * Espera que s'apropi una polsera i en retorna l'UID normalitzat.
 * Retorna null si es cancel·la (cancelNfcRead) o si el xip no té un UID vàlid.
 */
export async function readWristbandUid(): Promise<string | null> {
  try {
    await NfcManager.requestTechnology([NfcTech.NfcA, NfcTech.IsoDep, NfcTech.MifareIOS], {
      alertMessage: 'Apropa la polsera al mòbil',
    });
    const tag = await NfcManager.getTag();
    const uid = tag?.id ? normalizeUid(String(tag.id)) : null;
    if (Platform.OS === 'ios') await NfcManager.setAlertMessageIOS('Polsera llegida');
    return uid && isValidUid(uid) ? uid : null;
  } catch {
    return null;
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

export async function cancelNfcRead(): Promise<void> {
  await NfcManager.cancelTechnologyRequest().catch(() => undefined);
}
