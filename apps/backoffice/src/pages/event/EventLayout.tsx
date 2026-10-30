import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { EVENT_STATUS_LABELS, type EventSummary } from '@cashless/shared';
import { api } from '../../api';
import { Badge, ErrorBox, Loading, useLoad } from '../../ui';

export interface EventContext {
  event: EventSummary;
  reloadEvent: () => Promise<void>;
}

export function useEventContext(): EventContext {
  return useOutletContext<EventContext>();
}

const TABS = [
  { to: '', label: 'Resum', end: true },
  { to: 'settings', label: 'Configuració' },
  { to: 'catalog', label: 'Venedors i productes' },
  { to: 'staff', label: 'Operadors i terminals' },
  { to: 'movements', label: 'Moviments' },
  { to: 'wristbands', label: 'Polseres' },
  { to: 'cash', label: 'Caixa' },
];

export function EventLayout() {
  const { eventId } = useParams();
  const { data: event, error, reload } = useLoad(() => api.get<EventSummary>(`/events/${eventId}`), [eventId]);

  if (error) return <ErrorBox message={error} />;
  if (!event) return <Loading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <p>
            {new Date(event.startsAt).toLocaleString('ca-ES', { dateStyle: 'medium', timeStyle: 'short' })} –{' '}
            {new Date(event.endsAt).toLocaleString('ca-ES', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <Badge tone={event.status === 'active' ? 'good' : event.status === 'closed' ? 'neutral' : 'warn'}>{EVENT_STATUS_LABELS[event.status]}</Badge>
      </div>
      {event.status === 'draft' && (
        <div className="notice">L’esdeveniment està en esborrany: els terminals no poden vendre ni recarregar fins que l’activis a Configuració.</div>
      )}
      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ event, reloadEvent: reload } satisfies EventContext} />
    </>
  );
}
