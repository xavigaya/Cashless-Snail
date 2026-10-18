/** Converteix errors de l'API en missatges clars per a la pantalla de resultat. */
import { formatEuros } from '@cashless/shared';
import { ApiRequestError } from './api';
import type { ResultState } from './components';

export function errorResult(error: unknown, fallback = 'No s’ha pogut fer l’operació'): ResultState {
  if (!(error instanceof ApiRequestError)) {
    return { ok: false, title: fallback, detail: error instanceof Error ? error.message : undefined };
  }
  const details = error.error.details as { availableCents?: number; totalCents?: number } | undefined;
  switch (error.error.code) {
    case 'INSUFFICIENT_BALANCE':
      return {
        ok: false,
        title: 'Saldo insuficient',
        detail:
          details?.availableCents !== undefined && details.totalCents !== undefined
            ? `Té ${formatEuros(details.availableCents)} i cal ${formatEuros(details.totalCents)}`
            : error.message,
      };
    case 'WRISTBAND_BLOCKED':
      return { ok: false, title: 'Polsera bloquejada', detail: 'Envia la persona a la taquilla' };
    case 'WRISTBAND_NOT_ACTIVATED':
      return { ok: false, title: 'Polsera no activada', detail: 'Cal activar-la a la taquilla d’aquest esdeveniment' };
    case 'WRISTBAND_NOT_FOUND':
      return { ok: false, title: 'Polsera no activada', detail: 'Cal activar-la a la taquilla' };
    case 'EVENT_NOT_ACTIVE':
      return { ok: false, title: 'Esdeveniment no actiu', detail: error.message };
    default:
      if (error.isNetwork) return { ok: false, title: 'Sense connexió', detail: 'Torna-ho a provar. L’operació no s’ha duplicat.' };
      return { ok: false, title: fallback, detail: error.message };
  }
}
