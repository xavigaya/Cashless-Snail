/**
 * Client de l'API per al terminal.
 * Cada operació porta un identificador generat aquí: si es perd la resposta i es reintenta,
 * el servidor no la duplica.
 */
import * as Crypto from 'expo-crypto';
import type {
  ActivationResult,
  ApiError,
  Balance,
  CashShift,
  OfflineSaleInput,
  Movement,
  OperationResult,
  OperatorSession,
  PairResult,
  Product,
  TerminalContext,
  WristbandRef,
} from '@cashless/shared';

const TIMEOUT_MS = 10_000;
const RETRIES = 2;

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }

  get isNetwork(): boolean {
    return this.error.statusCode === 0;
  }
}

export const newOperationId = (): string => Crypto.randomUUID();

function query(ref: WristbandRef): string {
  return ref.uid ? `uid=${encodeURIComponent(ref.uid)}` : `code=${encodeURIComponent(ref.code ?? '')}`;
}

export class TpvApi {
  operatorToken: string | null = null;

  constructor(
    readonly apiUrl: string,
    private readonly terminalToken: string | null,
  ) {}

  static async pair(apiUrl: string, pairingCode: string, deviceName: string): Promise<PairResult> {
    return new TpvApi(apiUrl, null).request<PairResult>('POST', '/tpv/pair', { pairingCode, deviceName });
  }

  context() {
    return this.request<TerminalContext>('GET', '/tpv/context');
  }

  async login(operatorId: string, pin: string): Promise<OperatorSession> {
    const session = await this.request<OperatorSession>('POST', '/tpv/login', { operatorId, pin });
    this.operatorToken = session.token;
    return session;
  }

  logout(): void {
    this.operatorToken = null;
  }

  catalog() {
    return this.request<Product[]>('GET', '/tpv/catalog');
  }

  balance(ref: WristbandRef) {
    return this.request<Balance>('GET', `/tpv/balance?${query(ref)}`);
  }

  recent() {
    return this.request<Movement[]>('GET', '/tpv/recent');
  }

  sale(id: string, wristband: WristbandRef, lines: { productId: string; quantity: number }[]) {
    return this.request<OperationResult>('POST', '/tpv/sales', { id, wristband, lines, clientCreatedAt: new Date().toISOString() }, true);
  }

  topup(id: string, wristband: WristbandRef, amountCents: number, method: 'cash' | 'card') {
    return this.request<OperationResult>('POST', '/tpv/topups', { id, wristband, amountCents, method, clientCreatedAt: new Date().toISOString() }, true);
  }

  activate(id: string, wristband: WristbandRef, method: 'cash' | 'card') {
    return this.request<ActivationResult>('POST', '/tpv/activations', { id, wristband, method, clientCreatedAt: new Date().toISOString() }, true);
  }

  /** Envia una venda feta sense connexió. Només necessita el token del terminal. */
  offlineSale(sale: Omit<OfflineSaleInput, 'clientCreatedAt'> & { clientCreatedAt: string }) {
    return this.request<OperationResult>('POST', '/tpv/offline-sales', sale);
  }

  currentShift() {
    return this.request<CashShift | null>('GET', '/tpv/shift');
  }

  openShift(id: string, openingFloatCents: number) {
    return this.request<CashShift>('POST', '/tpv/shift/open', { id, openingFloatCents }, true);
  }

  closeShift(shiftId: string, declaredCashCents: number, note?: string) {
    return this.request<CashShift>('POST', `/tpv/shift/${shiftId}/close`, { declaredCashCents, note }, true);
  }

  void(id: string, movementId: string, reason: string) {
    return this.request<OperationResult>('POST', '/tpv/voids', { id, movementId, reason }, true);
  }

  /**
   * Fa la petició. Les operacions amb identificador propi (`retry`) es reintenten
   * si falla la xarxa, perquè el servidor garanteix que no es dupliquen.
   */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, retry = false): Promise<T> {
    const attempts = retry ? RETRIES + 1 : 1;
    let lastError: ApiRequestError | null = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.once<T>(method, path, body);
      } catch (error) {
        if (!(error instanceof ApiRequestError) || !error.isNetwork) throw error;
        lastError = error;
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw lastError!;
  }

  private async once<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.terminalToken) headers['X-Terminal-Token'] = this.terminalToken;
    if (this.operatorToken) headers.Authorization = `Bearer ${this.operatorToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiRequestError({ statusCode: 0, code: 'INTERNAL_ERROR', message: 'Sense connexió amb el servidor' });
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      throw new ApiRequestError((data as ApiError | undefined) ?? { statusCode: response.status, code: 'INTERNAL_ERROR', message: `Error ${response.status}` });
    }
    return data as T;
  }
}
