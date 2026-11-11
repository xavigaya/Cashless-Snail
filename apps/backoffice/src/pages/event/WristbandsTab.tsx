import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCode, isValidCode, normalizeCode, normalizeUid, type Balance, type Movement, type Page, type WristbandSummary } from '@cashless/shared';
import { api, ApiRequestError, errorMessage } from '../../api';
import { nfcReader, READER_LABELS, useNfcCard, useReaderState } from '../../nfc';
import { CsvTools } from '../../csv-tools';
import { Badge, Empty, ErrorBox, formatDateTime, Loading, Money, Section, useAction } from '../../ui';
import { wristbandsCsv } from './csvSpecs';
import { useEventContext } from './EventLayout';
import { MovementTable } from './MovementTable';

interface Lookup {
  balance: Balance;
  movements: Movement[];
}

const STATUS_LABELS = { active: 'Activa', blocked: 'Bloquejada', lost: 'Perduda' } as const;
const PAGE_SIZE = 50;

export function WristbandsTab() {
  const { event } = useEventContext();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WristbandSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lookup | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const search = useAction();
  const status = useAction();
  const reader = useReaderState();
  const [registerMode, setRegisterMode] = useState(false);
  const [registered, setRegistered] = useState<{ uid: string; code: string; isNew: boolean; at: string }[]>([]);
  const [unknownUid, setUnknownUid] = useState<string | null>(null);

  const load = useCallback(
    async (q: string, offset: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (q.trim()) params.set('q', q.trim());
        if (offset) params.set('offset', offset);
        const page = await api.get<Page<WristbandSummary>>(`/events/${event.id}/wristbands?${params}`);
        setItems((prev) => (offset ? [...prev, ...page.items] : page.items));
        setNext(page.nextCursor);
        setListError(null);
      } catch (e) {
        setListError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [event.id],
  );

  // La llista es filtra mentre s'escriu (amb una petita espera per no fer una consulta per tecla).
  useEffect(() => {
    const timer = setTimeout(() => void load(query, null), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const open = async (ref: { code?: string; uid?: string }) => {
    const params = ref.code ? `code=${ref.code}` : `uid=${encodeURIComponent(ref.uid ?? '')}`;
    setUnknownUid(null);
    search.setError(null);
    try {
      setSelected(await api.get<Lookup>(`/events/${event.id}/wristbands/lookup?${params}`));
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      // Una polsera llegida amb el lector que encara no és al sistema: es pot registrar aquí mateix.
      if (ref.uid && e instanceof ApiRequestError && e.error.code === 'WRISTBAND_NOT_FOUND') setUnknownUid(ref.uid);
      else search.setError(errorMessage(e));
    }
  };

  /** Registra una polsera llegida (sense saldo) i en mostra el codi imprès assignat. */
  const register = useCallback(
    async (uid: string) => {
      try {
        const result = await api.post<{ created: number }>(`/events/${event.id}/import/wristbands`, { rows: [{ uid }] });
        const found = await api.get<Lookup>(`/events/${event.id}/wristbands/lookup?uid=${uid}`);
        setRegistered((list) => [
          { uid, code: found.balance.code, isNew: result.created > 0, at: new Date().toISOString() },
          ...list.filter((r) => r.uid !== uid),
        ]);
        setUnknownUid(null);
      } catch (e) {
        search.setError(errorMessage(e));
      }
    },
    [event.id, search.setError],
  );

  // Cada polsera que s'apropa al lector USB: en mode registre, es registra; si no, se'n mostra el detall.
  const onCard = useCallback(
    (uid: string) => {
      if (registerMode) void register(uid);
      else {
        setQuery('');
        void open({ uid });
      }
    },
    [registerMode, register],
  );
  useNfcCard(onCard);

  /** Cerca exacta (codi complet o UID), també entre polseres que encara no han fet res en aquest esdeveniment. */
  const lookupExact = () => {
    const code = normalizeCode(query);
    void open(isValidCode(code) ? { code } : { uid: normalizeUid(query) });
  };

  const refresh = async () => {
    if (selected) await open({ code: selected.balance.code });
    await load(query, null);
  };

  const setWristbandStatus = (value: 'active' | 'blocked' | 'lost') =>
    void status.run(async () => {
      await api.patch(`/events/${event.id}/wristbands/${selected!.balance.wristbandId}/status`, { status: value });
      await refresh();
    });

  const loadAll = async () => {
    const all: WristbandSummary[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await api.get<Page<WristbandSummary>>(`/events/${event.id}/wristbands?limit=1000&offset=${offset}`);
      all.push(...page.items);
      if (!page.nextCursor) return all;
    }
  };

  return (
    <>
      <Section title="Polseres de l’esdeveniment" actions={<CsvTools spec={wristbandsCsv(event.id, loadAll)} onImported={() => void load(query, null)} />}>
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (items.length === 1) void open({ code: items[0]!.code });
            else if (query.trim()) lookupExact();
          }}
        >
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Cerca per codi imprès o UID del xip</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Exemple: ABCDE-FGHJK, o una part del codi"
              autoFocus
            />
          </label>
          <button type="submit" className="primary" disabled={search.busy}>
            Cerca
          </button>
        </form>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Surten les polseres que han fet algun moviment en aquest esdeveniment. Clica’n una per veure’n el saldo i els moviments.
        </p>
        <div className="reader-panel">
          <span className={`reader-dot reader-${reader.kind}`} aria-hidden="true" />
          <span>{reader.kind === 'ready' ? `${READER_LABELS.ready}: apropa una polsera` : READER_LABELS[reader.kind]}</span>
          {reader.kind === 'off' ? (
            <button type="button" onClick={() => nfcReader.setEnabled(true)}>
              Fes servir un lector USB
            </button>
          ) : (
            <>
              <label className="checkbox field" style={{ margin: 0 }}>
                <input type="checkbox" checked={registerMode} onChange={(e) => setRegisterMode(e.target.checked)} />
                <span>Mode registre (cada polsera que s’apropi es registra)</span>
              </label>
              <button type="button" className="link" onClick={() => nfcReader.setEnabled(false)}>
                Desactiva
              </button>
            </>
          )}
        </div>
        {reader.kind === 'no-bridge' && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Cal tenir obert a l’ordinador el programa «Lector NFC de Cashless Snail» (vegeu docs/lector-nfc.md). Si el navegador demana
            permís per accedir a la xarxa local, accepta’l.
          </p>
        )}
        {unknownUid && (
          <div className="notice">
            La polsera {unknownUid} no està registrada.{' '}
            <button className="link" onClick={() => void register(unknownUid)}>
              Registra-la
            </button>
          </div>
        )}
        {registered.length > 0 && (
          <div className="ok">
            <strong>Registrades ara: {registered.filter((r) => r.isNew).length} noves</strong>
            {registered.length > registered.filter((r) => r.isNew).length && ` · ${registered.filter((r) => !r.isNew).length} ja hi eren`}
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, maxHeight: 160, overflowY: 'auto' }}>
              {registered.map((r) => (
                <li key={r.uid}>
                  <span className="mono">{formatCode(r.code)}</span> · UID <span className="mono">{r.uid}</span>
                  {r.isNew ? '' : ' (ja registrada)'}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ErrorBox message={listError ?? search.error} />

        {items.length === 0 && !loading ? (
          <Empty>
            {query.trim() ? (
              <>
                Cap polsera d’aquest esdeveniment coincideix amb «{query}».{' '}
                <button className="link" onClick={lookupExact}>
                  Busca-la entre totes les polseres
                </button>
              </>
            ) : (
              'Encara cap polsera ha fet moviments en aquest esdeveniment.'
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Codi</th>
                  <th>UID</th>
                  <th>Estat</th>
                  <th className="num">Saldo</th>
                  <th className="num">Moviments</th>
                  <th>Últim moviment</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr
                    key={w.wristbandId}
                    className={`clickable${selected?.balance.wristbandId === w.wristbandId ? ' selected' : ''}`}
                    onClick={() => void open({ code: w.code })}
                  >
                    <td className="mono">
                      <a
                        href={`#${w.code}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void open({ code: w.code });
                        }}
                      >
                        {formatCode(w.code)}
                      </a>
                    </td>
                    <td className="mono muted">{w.uid ?? '—'}</td>
                    <td>
                      {w.status !== 'active' ? (
                        <Badge tone="bad">{STATUS_LABELS[w.status]}</Badge>
                      ) : w.debtCents > 0 ? (
                        <Badge tone="warn">Deute</Badge>
                      ) : w.activatedInEvent ? (
                        <Badge tone="good">Activa</Badge>
                      ) : (
                        <Badge>No activada aquí</Badge>
                      )}
                    </td>
                    <td className="num">{w.debtCents > 0 ? <span style={{ color: 'var(--bad)' }}>−<Money cents={w.debtCents} /></span> : <Money cents={w.availableCents} />}</td>
                    <td className="num">{w.movementsCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(w.lastMovementAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loading && <Loading />}
        {next && !loading && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => void load(query, next)}>Carrega’n més</button>
          </div>
        )}
      </Section>

      <div ref={detailRef}>
        {selected && (
          <Section
            title={`Polsera ${formatCode(selected.balance.code)}`}
            actions={
              <div className="toolbar">
                {selected.balance.status === 'active' ? (
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
                <button onClick={() => setSelected(null)} aria-label="Tanca el detall">
                  ✕
                </button>
              </div>
            }
          >
            <div className="stats">
              <div className="stat">
                <div className="stat-label">Estat</div>
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>
                  <Badge tone={selected.balance.status === 'active' ? 'good' : 'bad'}>{STATUS_LABELS[selected.balance.status]}</Badge>{' '}
                  {selected.balance.activatedInEvent ? <Badge tone="good">Activada aquí</Badge> : <Badge tone="warn">No activada aquí</Badge>}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Saldo pagat</div>
                <div className="stat-value">
                  <Money cents={Math.max(0, selected.balance.paidCents)} />
                </div>
              </div>
              {selected.balance.debtCents > 0 && (
                <div className="stat">
                  <div className="stat-label">Deute</div>
                  <div className="stat-value" style={{ color: 'var(--bad)' }}>
                    <Money cents={selected.balance.debtCents} />
                  </div>
                  <div className="muted">Vendes sense connexió sense saldo: no pot comprar fins que recarregui</div>
                </div>
              )}
              <div className="stat">
                <div className="stat-label">Saldo promocional</div>
                <div className="stat-value">
                  <Money cents={selected.balance.promoCents} />
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Fiança</div>
                <div className="stat-value">
                  <Money cents={selected.balance.depositCents} />
                </div>
              </div>
            </div>
            <ErrorBox message={status.error} />
            {selected.movements.length === 0 ? (
              <Empty>Sense moviments en aquest esdeveniment.</Empty>
            ) : (
              <MovementTable eventId={event.id} items={selected.movements} onChanged={() => void refresh()} />
            )}
          </Section>
        )}
      </div>
    </>
  );
}
