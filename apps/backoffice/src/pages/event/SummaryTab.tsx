import { useEffect } from 'react';
import { formatEuros, type EventTotals } from '@cashless/shared';
import { api } from '../../api';
import { Empty, ErrorBox, Loading, Money, Section, useLoad } from '../../ui';
import { useEventContext } from './EventLayout';

const REFRESH_MS = 15_000;

export function SummaryTab() {
  const { event } = useEventContext();
  const { data, error, reload } = useLoad(() => api.get<EventTotals>(`/events/${event.id}/summary`), [event.id]);

  // Mentre l'esdeveniment està actiu, les xifres s'actualitzen soles.
  useEffect(() => {
    if (event.status !== 'active') return;
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [event.status, reload]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const stats = [
    { label: 'Vendes', value: formatEuros(data.salesCents), sub: `${data.salesCount} tiquets` },
    { label: 'Recàrregues', value: formatEuros(data.topupsCents) },
    { label: 'Saldo en circulació', value: formatEuros(data.paidBalanceOutstandingCents + data.promoBalanceOutstandingCents) },
    { label: 'Polseres actives', value: String(data.activeWristbands) },
    { label: 'Tiquet mitjà', value: formatEuros(data.averageTicketCents) },
    { label: 'Preu de polseres', value: formatEuros(data.wristbandFeesCents) },
    ...(data.offlineSalesCount > 0
      ? [{ label: 'Vendes sense connexió', value: String(data.offlineSalesCount), sub: `${data.offlineIssuesCount} amb incidències` }]
      : []),
    ...(data.debtOutstandingCents > 0 ? [{ label: 'Deute pendent', value: formatEuros(data.debtOutstandingCents), sub: 'de vendes sense connexió' }] : []),
  ];

  return (
    <>
      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            {s.sub && <div className="muted">{s.sub}</div>}
          </div>
        ))}
      </div>

      <Section title="Vendes per venedor">
        {data.salesByVendor.length === 0 ? (
          <Empty>Encara no hi ha vendes.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venedor</th>
                  <th className="num">Tiquets</th>
                  <th className="num">Vendes</th>
                </tr>
              </thead>
              <tbody>
                {data.salesByVendor.map((v) => (
                  <tr key={v.vendorId}>
                    <td>{v.vendorName}</td>
                    <td className="num">{v.count}</td>
                    <td className="num">
                      <Money cents={v.salesCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Productes més venuts">
        {data.topProducts.length === 0 ? (
          <Empty>Encara no hi ha vendes.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producte</th>
                  <th className="num">Unitats</th>
                  <th className="num">Import</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td className="num">{p.quantity}</td>
                    <td className="num">
                      <Money cents={p.totalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Diners">
        <table>
          <tbody>
            <tr>
              <td>Recàrregues en efectiu</td>
              <td className="num">
                <Money cents={data.topupsByMethod.cash} />
              </td>
            </tr>
            <tr>
              <td>Recàrregues amb targeta</td>
              <td className="num">
                <Money cents={data.topupsByMethod.card} />
              </td>
            </tr>
            <tr>
              <td>Recàrregues online</td>
              <td className="num">
                <Money cents={data.topupsByMethod.online} />
              </td>
            </tr>
            <tr>
              <td>Saldo pagat pendent de gastar o retornar</td>
              <td className="num">
                <Money cents={data.paidBalanceOutstandingCents} />
              </td>
            </tr>
            <tr>
              <td>Fiances en dipòsit</td>
              <td className="num">
                <Money cents={data.depositsHeldCents} />
              </td>
            </tr>
            <tr>
              <td>Import anul·lat</td>
              <td className="num">
                <Money cents={data.voidsCents} />
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </>
  );
}
