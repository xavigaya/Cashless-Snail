/**
 * Vendes sense connexió.
 *
 * Quan la barra perd la xarxa, el terminal pot cobrar igualment fins al límit de l'esdeveniment
 * (per venda i per polsera). La venda es desa al dispositiu i s'envia quan torna la connexió.
 * L'identificador és el mateix que s'havia intentat enviar: si el servidor sí que l'havia rebuda,
 * no es duplica.
 *
 * També es desa l'últim catàleg, per poder vendre encara que l'app s'obri sense xarxa.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Product, TerminalContext, WristbandRef } from '@cashless/shared';
import { ApiRequestError, type TpvApi } from './api';

const KEYS = {
  queue: 'cashless.offline.queue',
  rejected: 'cashless.offline.rejected',
  catalog: 'cashless.catalog',
  context: 'cashless.context',
};

export interface QueuedSale {
  id: string;
  /** Terminal que la va cobrar: només es pot enviar amb el token d'aquest terminal. */
  terminalId: string;
  wristband: WristbandRef;
  operatorId: string;
  lines: { productId: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  clientCreatedAt: string;
}

export interface RejectedSale extends QueuedSale {
  code: string;
  message: string;
}

export interface QueueState {
  pending: QueuedSale[];
  rejected: RejectedSale[];
  syncing: boolean;
}

export const wristbandKey = (ref: WristbandRef) => ref.uid ?? `code:${ref.code}`;

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

class OfflineQueue {
  private state: QueueState = { pending: [], rejected: [], syncing: false };
  private loaded: Promise<void> | null = null;
  private listeners = new Set<(s: QueueState) => void>();
  /** Els canvis a la cua es fan d'un en un: cada canvi parteix de l'estat que ha deixat l'anterior. */
  private lock: Promise<void> = Promise.resolve();

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const [pending, rejected] = await Promise.all([readList<QueuedSale>(KEYS.queue), readList<RejectedSale>(KEYS.rejected)]);
      this.set({ pending, rejected });
    })();
    return this.loaded;
  }

  get current(): QueueState {
    return this.state;
  }

  subscribe(listener: (s: QueueState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Import pendent d'enviar d'una polsera en aquest terminal (per aplicar el límit per polsera). */
  pendingFor(ref: WristbandRef): number {
    const key = wristbandKey(ref);
    return this.state.pending.filter((s) => wristbandKey(s.wristband) === key).reduce((sum, s) => sum + s.totalCents, 0);
  }

  add(sale: QueuedSale): Promise<void> {
    return this.mutate(async () => {
      if (this.state.pending.some((s) => s.id === sale.id)) return;
      const pending = [...this.state.pending, sale];
      // Primer es desa al dispositiu: si l'app es tanca, la venda no es perd.
      await AsyncStorage.setItem(KEYS.queue, JSON.stringify(pending));
      this.set({ pending });
    });
  }

  clearRejected(): Promise<void> {
    return this.mutate(async () => {
      await AsyncStorage.removeItem(KEYS.rejected);
      this.set({ rejected: [] });
    });
  }

  /**
   * Envia les vendes pendents en ordre.
   * - Sense xarxa o terminal no autoritzat: s'atura i es tornarà a provar.
   * - Error del servidor: aquella venda es reintentarà, però es continua amb les altres.
   * - Rebutjada (dades incorrectes): es guarda apart perquè el cap de barra la vegi; el servidor també la desa a l'auditoria.
   */
  async sync(api: TpvApi, terminalId: string): Promise<void> {
    await this.load();
    if (this.state.syncing || this.state.pending.length === 0) return;
    this.set({ syncing: true });
    try {
      for (const sale of [...this.state.pending]) {
        if (sale.terminalId !== terminalId) {
          await this.reject({ ...sale, code: 'FORBIDDEN', message: 'Venda feta amb aquest mòbil quan estava vinculat a un altre terminal' });
          continue;
        }
        try {
          await api.offlineSale({
            id: sale.id,
            wristband: sale.wristband,
            operatorId: sale.operatorId,
            lines: sale.lines,
            clientCreatedAt: sale.clientCreatedAt,
          });
          await this.remove(sale.id);
        } catch (error) {
          const status = error instanceof ApiRequestError ? error.error.statusCode : 0;
          if (status === 0 || status === 401) return;
          if (status >= 500 || status === 429) continue;
          const e = (error as ApiRequestError).error;
          await this.reject({ ...sale, code: e.code, message: e.message });
        }
      }
    } finally {
      this.set({ syncing: false });
    }
  }

  private remove(id: string): Promise<void> {
    return this.mutate(async () => {
      const pending = this.state.pending.filter((s) => s.id !== id);
      await AsyncStorage.setItem(KEYS.queue, JSON.stringify(pending));
      this.set({ pending });
    });
  }

  private async reject(sale: RejectedSale): Promise<void> {
    await this.mutate(async () => {
      const rejected = [...this.state.rejected, sale];
      await AsyncStorage.setItem(KEYS.rejected, JSON.stringify(rejected));
      this.set({ rejected });
    });
    await this.remove(sale.id);
  }

  private mutate(change: () => Promise<void>): Promise<void> {
    const run = this.lock.then(async () => {
      await this.load();
      await change();
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private set(patch: Partial<QueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

export const offlineQueue = new OfflineQueue();

/** Context del terminal desat, per poder arrencar l'app sense xarxa. */
export async function saveContext(context: TerminalContext): Promise<void> {
  await AsyncStorage.setItem(KEYS.context, JSON.stringify(context)).catch(() => undefined);
}

export async function loadContext(): Promise<TerminalContext | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.context);
    return raw ? (JSON.parse(raw) as TerminalContext) : null;
  } catch {
    return null;
  }
}

/** En desvincular el terminal s'esborra el que és propi d'aquell punt de venda (no les vendes pendents). */
export async function clearTerminalCache(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.catalog, KEYS.context]).catch(() => undefined);
}

export async function saveCatalog(products: Product[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.catalog, JSON.stringify(products)).catch(() => undefined);
}

export async function loadCatalog(): Promise<Product[] | null> {
  const list = await readList<Product>(KEYS.catalog);
  return list.length > 0 ? list : null;
}
