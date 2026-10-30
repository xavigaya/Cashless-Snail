import { MOVEMENT_TYPE_LABELS, OFFLINE_ISSUE_LABELS, PAYMENT_METHOD_LABELS, formatCode, type Movement } from '@cashless/shared';
import { api } from '../../api';
import { Badge, ErrorBox, formatDateTime, Money, useAction } from '../../ui';

/** Taula de moviments amb opció d'anul·lar vendes i recàrregues. */
export function MovementTable({ eventId, items, onChanged }: { eventId: string; items: Movement[]; onChanged: () => void }) {
  const voidAction = useAction();

  const requestVoid = (m: Movement) => {
    const reason = window.prompt(`Motiu de l’anul·lació (${MOVEMENT_TYPE_LABELS[m.type]} de ${(m.amountCents / 100).toFixed(2)} €)`);
    if (!reason || reason.trim().length < 3) return;
    void voidAction.run(async () => {
      await api.post(`/events/${eventId}/voids`, { id: crypto.randomUUID(), movementId: m.id, reason: reason.trim() });
      onChanged();
    });
  };

  return (
    <>
      <ErrorBox message={voidAction.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipus</th>
              <th>Polsera</th>
              <th>Detall</th>
              <th>Operador</th>
              <th className="num">Import</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => {
              const voidable = (m.type === 'sale' || m.type === 'topup') && !m.voidedByMovementId;
              return (
                <tr key={m.id} style={{ opacity: m.voidedByMovementId ? 0.55 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }} title={m.offline ? `Sincronitzada: ${formatDateTime(m.createdAt)}` : undefined}>
                    {formatDateTime(m.offline && m.clientCreatedAt ? m.clientCreatedAt : m.createdAt)}
                  </td>
                  <td>
                    {MOVEMENT_TYPE_LABELS[m.type]}
                    {m.voidedByMovementId && (
                      <>
                        {' '}
                        <Badge tone="bad">anul·lat</Badge>
                      </>
                    )}
                    {m.offline && (
                      <>
                        {' '}
                        <Badge tone={m.offlineIssues.length > 0 ? 'warn' : 'neutral'}>sense connexió</Badge>
                      </>
                    )}
                    {m.offlineIssues.length > 0 && (
                      <div className="muted" style={{ fontSize: '0.85em' }}>
                        {m.offlineIssues.map((code) => OFFLINE_ISSUE_LABELS[code] ?? code).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{m.wristbandCode ? formatCode(m.wristbandCode) : '—'}</td>
                  <td>
                    {m.lines.length > 0
                      ? m.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')
                      : m.type === 'void'
                        ? m.reason
                        : PAYMENT_METHOD_LABELS[m.paymentMethod]}
                  </td>
                  <td>{m.operatorName ?? (m.terminalId ? '—' : 'Backoffice')}</td>
                  <td className="num">
                    <Money cents={m.paidDeltaCents + m.promoDeltaCents !== 0 ? m.paidDeltaCents + m.promoDeltaCents : m.amountCents} />
                  </td>
                  <td className="num">
                    {voidable && (
                      <button className="link danger" disabled={voidAction.busy} onClick={() => requestVoid(m)}>
                        Anul·la
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
