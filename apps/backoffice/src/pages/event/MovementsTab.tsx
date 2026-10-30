import { useCallback, useEffect, useState } from 'react';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES, type Movement, type MovementType, type Page } from '@cashless/shared';
import { api, errorMessage } from '../../api';
import { Empty, ErrorBox, Field, Loading, Section } from '../../ui';
import { useEventContext } from './EventLayout';
import { MovementTable } from './MovementTable';

const PAGE_SIZE = 50;

export function MovementsTab() {
  const { event } = useEventContext();
  const [type, setType] = useState<MovementType | ''>('');
  const [offline, setOffline] = useState<'' | 'offline' | 'issues'>('');
  const [items, setItems] = useState<Movement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (type) params.set('type', type);
        if (offline) params.set('offline', offline);
        if (after) params.set('cursor', after);
        const page = await api.get<Page<Movement>>(`/events/${event.id}/movements?${params}`);
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [event.id, type, offline],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <Section
      title="Moviments"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <Field label="Tipus">
            <select value={type} onChange={(e) => setType(e.target.value as MovementType | '')}>
              <option value="">Tots</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sense connexió">
            <select value={offline} onChange={(e) => setOffline(e.target.value as '' | 'offline' | 'issues')}>
              <option value="">Tots</option>
              <option value="offline">Vendes sense connexió</option>
              <option value="issues">Amb incidències</option>
            </select>
          </Field>
          <button onClick={() => void load(null)}>Actualitza</button>
        </div>
      }
    >
      <ErrorBox message={error} />
      {items.length === 0 && !loading && <Empty>Cap moviment.</Empty>}
      {items.length > 0 && <MovementTable eventId={event.id} items={items} onChanged={() => void load(null)} />}
      {loading && <Loading />}
      {cursor && !loading && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => void load(cursor)}>Carrega’n més</button>
        </div>
      )}
    </Section>
  );
}
