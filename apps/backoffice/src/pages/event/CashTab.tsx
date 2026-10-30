import { useEffect } from 'react';
import { parseEuros, type CashDailyRow, type CashReport, type CashShift } from '@cashless/shared';
import { api } from '../../api';
import { Badge, Empty, ErrorBox, formatDateTime, Loading, Money, Section, useAction, useLoad } from '../../ui';
import { useEventContext } from './EventLayout';

const REFRESH_MS = 15_000;

/** Caixa: torns de les taquilles (per operador) i totals per terminal i jornada. */
export function CashTab() {
  const { event } = useEventContext();
  const { data, error, reload } = useLoad(() => api.get<CashReport>(`/events/${event.id}/cash`), [event.id]);
  const closeAction = useAction();

  useEffect(() => {
    if (event.status !== 'active') return;
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [event.status, reload]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const close = (shift: CashShift) => {
    const text = window.prompt(
      `Tancar el torn de ${shift.operatorName} (${shift.terminalName}).\nEfectiu comptat al calaix, inclòs el fons de canvi (€):`,
    );
    if (text === null) return;
    const cents = parseEuros(text);
    if (cents === null || cents < 0) {
      closeAction.setError('Import no vàlid');
      return;
    }
    void closeAction.run(async () => {
      await api.post(`/events/${event.id}/cash/shifts/${shift.id}/close`, { declaredCashCents: cents, note: 'Tancat des del backoffice' });
      await reload();
    });
  };

  const days = groupByDay(data.daily);

  return (
    <>
      <Section title="Torns de caixa">
        <p className="muted">
          Cada taquiller obre la caixa amb el fons de canvi i la tanca comptant l’efectiu. L’esperat és el fons més l’efectiu cobrat
          (polseres, fiances i recàrregues). La targeta s’ha de quadrar amb el datàfon.
        </p>
        <ErrorBox message={closeAction.error} />
        {data.shifts.length === 0 ? (
          <Empty>Encara no s’ha obert cap caixa.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Taquiller</th>
                  <th>Terminal</th>
                  <th>Obert</th>
                  <th>Tancat</th>
                  <th className="num">Fons</th>
                  <th className="num">Efectiu cobrat</th>
                  <th className="num">Targeta</th>
                  <th className="num">Esperat</th>
                  <th className="num">Comptat</th>
                  <th className="num">Diferència</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.operatorName}</td>
                    <td>{s.terminalName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.openedAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {s.closedAt ? (
                        <>
                          {formatDateTime(s.closedAt)}
                          {s.closedByName && s.closedByName !== s.operatorName && <div className="muted">per {s.closedByName}</div>}
                        </>
                      ) : (
                        <Badge tone="good">obert</Badge>
                      )}
                    </td>
                    <td className="num">
                      <Money cents={s.openingFloatCents} />
                    </td>
                    <td className="num">
                      <Money cents={s.cashCents} />
                    </td>
                    <td className="num">
                      <Money cents={s.cardCents} />
                    </td>
                    <td className="num">
                      <Money cents={s.expectedCashCents} />
                    </td>
                    <td className="num">{s.declaredCashCents === null ? '—' : <Money cents={s.declaredCashCents} />}</td>
                    <td className="num">
                      {s.differenceCents === null ? (
                        '—'
                      ) : (
                        <Badge tone={s.differenceCents === 0 ? 'good' : Math.abs(s.differenceCents) <= 200 ? 'warn' : 'bad'}>
                          {s.differenceCents > 0 ? '+' : ''}
                          <Money cents={s.differenceCents} />
                        </Badge>
                      )}
                      {s.note && <div className="muted">{s.note}</div>}
                    </td>
                    <td className="num">
                      {!s.closedAt && (
                        <button className="link danger" disabled={closeAction.busy} onClick={() => close(s)}>
                          Tanca
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Per terminal i jornada">
        <p className="muted">Una jornada va de les 6:00 a les 6:00 de l’endemà. Les vendes són netes d’anul·lacions.</p>
        {days.length === 0 ? (
          <Empty>Encara no hi ha moviments.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jornada</th>
                  <th>Terminal</th>
                  <th>Punt de venda</th>
                  <th className="num">Operacions</th>
                  <th className="num">Efectiu</th>
                  <th className="num">Targeta</th>
                  <th className="num">Vendes</th>
                </tr>
              </thead>
              <tbody>
                {days.map(({ day, rows, total }) => (
                  <DayRows key={day} day={day} rows={rows} total={total} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function DayRows({ day, rows, total }: { day: string; rows: CashDailyRow[]; total: Omit<CashDailyRow, 'day' | 'terminalId' | 'terminalName' | 'pointOfSaleName'> }) {
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <>
      {rows.map((r, i) => (
        <tr key={`${day}-${r.terminalId ?? 'backoffice'}`}>
          <td>{i === 0 ? label : ''}</td>
          <td>{r.terminalName}</td>
          <td>{r.pointOfSaleName ?? '—'}</td>
          <td className="num">{r.operations}</td>
          <td className="num">
            <Money cents={r.cashCents} />
          </td>
          <td className="num">
            <Money cents={r.cardCents} />
          </td>
          <td className="num">
            <Money cents={r.salesCents} />
          </td>
        </tr>
      ))}
      <tr style={{ fontWeight: 600 }}>
        <td />
        <td colSpan={2}>Total {label}</td>
        <td className="num">{total.operations}</td>
        <td className="num">
          <Money cents={total.cashCents} />
        </td>
        <td className="num">
          <Money cents={total.cardCents} />
        </td>
        <td className="num">
          <Money cents={total.salesCents} />
        </td>
      </tr>
    </>
  );
}

function groupByDay(rows: CashDailyRow[]) {
  const byDay = new Map<string, CashDailyRow[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  return [...byDay.entries()].map(([day, list]) => ({
    day,
    rows: list,
    total: {
      operations: list.reduce((s, r) => s + r.operations, 0),
      cashCents: list.reduce((s, r) => s + r.cashCents, 0),
      cardCents: list.reduce((s, r) => s + r.cardCents, 0),
      salesCents: list.reduce((s, r) => s + r.salesCents, 0),
    },
  }));
}
