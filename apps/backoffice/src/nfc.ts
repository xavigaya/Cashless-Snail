/**
 * Lector NFC USB (ACR122U o qualsevol lector PC/SC) al backoffice.
 *
 * El navegador no pot parlar directament amb el lector: ho fa el programa «Lector NFC de Cashless Snail»
 * (apps/lector-nfc), que s'executa a l'ordinador i envia l'UID de cada polsera per
 * http://127.0.0.1:17321/events. Aquí només ens hi connectem i repartim les lectures.
 */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cashless.nfcReader';
const BRIDGE_URL = 'http://127.0.0.1:17321';

export type ReaderState =
  | { kind: 'off' }
  /** El pont no respon: el programa no està obert (o el navegador no hi deixa connectar). */
  | { kind: 'no-bridge' }
  /** El pont funciona, però no hi ha cap lector connectat. */
  | { kind: 'no-reader' }
  | { kind: 'ready'; reader: string };

interface BridgeEvent {
  type: 'reader' | 'card' | 'removed' | 'error';
  reader?: string;
  connected?: boolean;
  uid?: string;
  message?: string;
}

type CardListener = (uid: string) => void;

class NfcReader {
  private source: EventSource | null = null;
  private stateListeners = new Set<(s: ReaderState) => void>();
  private cardListeners = new Set<CardListener>();
  state: ReaderState = { kind: 'off' };
  lastError: string | null = null;

  constructor() {
    if (this.storedEnabled()) this.connect();
  }

  get enabled(): boolean {
    return this.source !== null;
  }

  setEnabled(on: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Sense emmagatzematge: el valor durarà fins que es tanqui la pàgina.
    }
    if (on) this.connect();
    else this.disconnect();
  }

  onState(listener: (s: ReaderState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /** Rep l'UID (hexadecimal, majúscules) de cada polsera que s'apropa al lector. */
  onCard(listener: CardListener): () => void {
    this.cardListeners.add(listener);
    return () => this.cardListeners.delete(listener);
  }

  private storedEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      return false;
    }
  }

  private connect(): void {
    if (this.source) return;
    const source = new EventSource(`${BRIDGE_URL}/events`);
    this.source = source;
    this.setState({ kind: 'no-bridge' });
    source.onmessage = (message) => {
      let e: BridgeEvent;
      try {
        e = JSON.parse(message.data as string) as BridgeEvent;
      } catch {
        return;
      }
      if (e.type === 'reader') this.setState(e.connected && e.reader ? { kind: 'ready', reader: e.reader } : { kind: 'no-reader' });
      if (e.type === 'card' && e.uid) for (const l of this.cardListeners) l(e.uid);
      if (e.type === 'error') this.lastError = e.message ?? null;
    };
    // L'EventSource es reconnecta sol; mentrestant, es mostra que el programa no respon.
    source.onerror = () => this.setState({ kind: 'no-bridge' });
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
    this.setState({ kind: 'off' });
  }

  private setState(s: ReaderState): void {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }
}

export const nfcReader = new NfcReader();

export function useReaderState(): ReaderState {
  const [state, setState] = useState<ReaderState>(nfcReader.state);
  useEffect(() => nfcReader.onState(setState), []);
  return state;
}

/** Crida `handler` amb l'UID de cada polsera llegida mentre el component és a la pantalla. */
export function useNfcCard(handler: CardListener): void {
  useEffect(() => nfcReader.onCard(handler), [handler]);
}

export const READER_LABELS: Record<ReaderState['kind'], string> = {
  off: 'Lector USB desactivat',
  'no-bridge': 'Lector USB: obre el programa «Lector NFC»',
  'no-reader': 'Lector USB: connecta el lector',
  ready: 'Lector USB a punt',
};
