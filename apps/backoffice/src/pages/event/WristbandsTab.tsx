import { useState } from 'react';
import { formatCode, isValidCode, normalizeCode, normalizeUid, type Balance, type Movement } from '@cashless/shared';
import { api } from '../../api';
import { Badge, Empty, Field, Form, Money, Section, useAction } from '../../ui';
import { useEventContext } from './EventLayout';
import { MovementTable } from './MovementTable';

interface Lookup {
  balance: Balance;
  movements: Movement[];
}

const STATUS_LABELS = { active: 'Activa', blocked: 'Bloquejada', lost: 'Perduda' } as const;

export function WristbandsTab() {
  const { event } = useEventContext();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Lookup | null>(null);
  const search = useAction();
  const status = useAction();

  const lookup = async (text = query) => {
    const code = normalizeCode(text);
    const params = isValidCode(code) ? `code=${code}` : `uid=${normalizeUid(text)}`;
    await search.run(async () => setResult(await api.get<Lookup>(`/events/${event.id}/wristbands/lookup?${params}`)));
  };

  const setWristbandStatus = (value: 'active' | 'blocked' | 'lost') =>
    void status.run(async () => {
      await api.patch(`/events/${event.id}/wristbands/${result!.balance.wristbandId}/status`, { status: value });
      await lookup();
    });

  return (
    <>
      <Section title="Cerca una polsera">
        <Form submitLabel="Cerca" busy={search.busy} error={search.error} onSubmit={() => lookup()}>
          <Field label="Codi imprès o UID del xip" hint="Exemple: ABCDE-FGHJK">
            <input value={query} onChange={(e) => setQuery(e.target.value)} required autoFocus />
          </Field>
        </Form>
      </Section>

      {result && (
        <Section
          title={`Polsera ${formatCode(result.balance.code)}`}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              {result.balance.status === 'active' ? (
                <>
                  <button className="danger" disabled={status.busy} onClick={() => setWristbandStatus('blocked')}>
                    Bloqueja
                  </button>
                  <button className="danger" disabled={status.busy} onClick={() => setWristbandStatus('lost')}>
                    Marca com a perduda
                  </button>
                </>
              ) : (
                <button disabled={status.busy} onClick={() => setWristbandStatus('active')}>
                  Desbloqueja
                </button>
              )}
            </div>
          }
        >
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Estat</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>
                <Badge tone={result.balance.status === 'active' ? 'good' : 'bad'}>{STATUS_LABELS[result.balance.status]}</Badge>{' '}
                {result.balance.activatedInEvent ? <Badge tone="good">Activada aquí</Badge> : <Badge tone="warn">No activada aquí</Badge>}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Saldo pagat</div>
              <div className="stat-value">
                <Money cents={result.balance.paidCents} />
              </div>
            </div>
            {result.balance.debtCents > 0 && (
              <div className="stat">
                <div className="stat-label">Deute</div>
                <div className="stat-value" style={{ color: 'var(--bad)' }}>
                  <Money cents={result.balance.debtCents} />
                </div>
                <div className="muted">Vendes sense connexió sense saldo: no pot comprar fins que recarregui</div>
              </div>
            )}
            <div className="stat">
              <div className="stat-label">Saldo promocional</div>
              <div className="stat-value">
                <Money cents={result.balance.promoCents} />
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Fiança</div>
              <div className="stat-value">
                <Money cents={result.balance.depositCents} />
              </div>
            </div>
          </div>
          {status.error && <div className="error">{status.error}</div>}
          {result.movements.length === 0 ? (
            <Empty>Sense moviments en aquest esdeveniment.</Empty>
          ) : (
            <MovementTable eventId={event.id} items={result.movements} onChanged={() => void lookup()} />
          )}
        </Section>
      )}
    </>
  );
}
