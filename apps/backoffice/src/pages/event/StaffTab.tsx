import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  OPERATOR_ROLE_LABELS,
  OPERATOR_ROLES,
  pairingQrPayload,
  POS_KIND_LABELS,
  type Operator,
  type OperatorRole,
  type PointOfSale,
  type Terminal,
} from '@cashless/shared';
import { api } from '../../api';
import { CsvTools } from '../../csv-tools';
import { Badge, Empty, ErrorBox, Field, Form, formatDateTime, Modal, Section, useAction, useLoad } from '../../ui';
import { confirmDelete } from './CatalogTab';
import { operatorsCsv, terminalsCsv } from './csvSpecs';
import { useEventContext } from './EventLayout';

export function StaffTab() {
  const { event } = useEventContext();
  return (
    <>
      <OperatorsSection eventId={event.id} />
      <TerminalsSection eventId={event.id} />
    </>
  );
}

function OperatorForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Operator;
  submitLabel: string;
  onSubmit: (body: { name: string; role: OperatorRole; pin?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<OperatorRole>(initial?.role ?? 'cashier');
  const action = useAction();
  return (
    <Form
      submitLabel={submitLabel}
      busy={action.busy}
      error={action.error}
      onSubmit={async () => {
        const ok = await action.run(() => onSubmit({ name, role, pin: pin || undefined }));
        if (ok && !initial) {
          setName('');
          setPin('');
        }
      }}
    >
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </Field>
      <Field label="PIN" hint={initial ? 'Deixa-ho buit per no canviar-lo' : '4 a 6 xifres'}>
        <input inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value)} required={!initial} autoComplete="off" />
      </Field>
      <Field label="Rol">
        <select value={role} onChange={(e) => setRole(e.target.value as OperatorRole)}>
          {OPERATOR_ROLES.map((r) => (
            <option key={r} value={r}>
              {OPERATOR_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
    </Form>
  );
}

function OperatorsSection({ eventId }: { eventId: string }) {
  const operators = useLoad(() => api.get<Operator[]>(`/events/${eventId}/operators`), [eventId]);
  const [editing, setEditing] = useState<Operator | null>(null);
  const act = useAction();
  const reload = () => void operators.reload();

  return (
    <Section title="Operadors" actions={<CsvTools spec={operatorsCsv(eventId, operators.data ?? [])} onImported={reload} />}>
      <p className="muted" style={{ marginTop: -6 }}>
        Voluntaris que treballen als terminals. Entren triant el seu nom i escrivint el PIN.
      </p>
      <ErrorBox message={operators.error ?? act.error} />
      {operators.data?.length === 0 ? (
        <Empty>Cap operador encara.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rol</th>
                <th>Estat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {operators.data?.map((op) => (
                <tr key={op.id}>
                  <td>{op.name}</td>
                  <td>{OPERATOR_ROLE_LABELS[op.role]}</td>
                  <td>{op.active ? <Badge tone="good">Actiu</Badge> : <Badge>Inactiu</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => setEditing(op)}>
                        Edita
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          void act.run(async () => {
                            await api.patch(`/events/${eventId}/operators/${op.id}`, { active: !op.active });
                            reload();
                          })
                        }
                      >
                        {op.active ? 'Desactiva' : 'Activa'}
                      </button>
                      <button className="link danger" onClick={() => confirmDelete(act, `l’operador «${op.name}»`, `/events/${eventId}/operators/${op.id}`, reload)}>
                        Esborra
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="subhead">Afegeix un operador</h3>
      <OperatorForm
        submitLabel="Afegeix l’operador"
        onSubmit={async (body) => {
          await api.post(`/events/${eventId}/operators`, body);
          reload();
        }}
      />
      {editing && (
        <Modal title={`Edita ${editing.name}`} onClose={() => setEditing(null)}>
          <OperatorForm
            initial={editing}
            submitLabel="Desa els canvis"
            onSubmit={async (body) => {
              await api.patch(`/events/${eventId}/operators/${editing.id}`, body);
              setEditing(null);
              reload();
            }}
          />
        </Modal>
      )}
    </Section>
  );
}

function TerminalForm({
  initial,
  pos,
  submitLabel,
  onSubmit,
}: {
  initial?: Terminal;
  pos: PointOfSale[];
  submitLabel: string;
  onSubmit: (body: { name: string; pointOfSaleId: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [posId, setPosId] = useState(initial?.pointOfSaleId ?? '');
  const action = useAction();
  return (
    <Form
      submitLabel={submitLabel}
      busy={action.busy}
      error={action.error}
      onSubmit={async () => {
        const ok = await action.run(() => onSubmit({ name, pointOfSaleId: posId }));
        if (ok && !initial) setName('');
      }}
    >
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Barra 1" required minLength={2} />
      </Field>
      <Field label="Punt de venda" hint={initial ? 'El canvi s’aplica quan el terminal torna a connectar' : undefined}>
        <select value={posId} onChange={(e) => setPosId(e.target.value)} required>
          <option value="">Tria’n un…</option>
          {pos
            .filter((p) => p.active || p.id === initial?.pointOfSaleId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({POS_KIND_LABELS[p.kind]})
              </option>
            ))}
        </select>
      </Field>
    </Form>
  );
}

function TerminalsSection({ eventId }: { eventId: string }) {
  const terminals = useLoad(() => api.get<Terminal[]>(`/events/${eventId}/terminals`), [eventId]);
  const pos = useLoad(() => api.get<PointOfSale[]>(`/events/${eventId}/points-of-sale`), [eventId]);
  const meta = useLoad(() => api.get<{ publicApiUrl: string }>('/meta'), []);
  const [editing, setEditing] = useState<Terminal | null>(null);
  const edit = useAction();
  const reload = () => void terminals.reload();

  const posLabel = (id: string) => {
    const p = pos.data?.find((x) => x.id === id);
    return p ? `${p.name} (${POS_KIND_LABELS[p.kind]})` : '—';
  };

  const act = (fn: () => Promise<unknown>) =>
    void edit.run(async () => {
      await fn();
      await terminals.reload();
    });

  return (
    <Section title="Terminals" actions={<CsvTools spec={terminalsCsv(eventId, terminals.data ?? [], pos.data ?? [])} onImported={reload} />}>
      <p className="muted" style={{ marginTop: -6 }}>
        Per vincular un mòbil, obre l’app TPV i escaneja el QR (o escriu el codi). El codi caduca als 30 minuts.
      </p>
      <ErrorBox message={terminals.error ?? edit.error} />
      {terminals.data?.length === 0 && <Empty>Cap terminal encara.</Empty>}
      {terminals.data?.map((t) => (
        <div key={t.id} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <strong>{t.name}</strong> · <span className="muted">{posLabel(t.pointOfSaleId)}</span>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {t.pairedAt ? `Vinculat a «${t.deviceName ?? 'dispositiu'}» · última connexió ${formatDateTime(t.lastSeenAt)}` : 'Encara no vinculat'}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {t.active ? <Badge tone="good">Actiu</Badge> : <Badge tone="bad">Desactivat</Badge>}
              <button onClick={() => act(() => api.post(`/events/${eventId}/terminals/${t.id}/pairing-code`))}>
                {t.pairedAt ? 'Vincula un altre dispositiu' : 'Nou codi'}
              </button>
              <button onClick={() => setEditing(t)}>Edita</button>
              <button className={t.active ? 'danger' : ''} onClick={() => act(() => api.patch(`/events/${eventId}/terminals/${t.id}`, { active: !t.active }))}>
                {t.active ? 'Desactiva' : 'Activa'}
              </button>
              <button className="danger" onClick={() => confirmDelete(edit, `el terminal «${t.name}»`, `/events/${eventId}/terminals/${t.id}`, reload)}>
                Esborra
              </button>
            </div>
          </div>
          {t.pairingCode && meta.data && (
            <div className="pairing">
              <div className="pairing-qr">
                <QRCodeSVG value={pairingQrPayload(meta.data.publicApiUrl, t.pairingCode)} size={148} />
              </div>
              <div>
                <div className="muted">Codi de vinculació</div>
                <div className="pairing-code">{t.pairingCode}</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Caduca: {formatDateTime(t.pairingExpiresAt)} · Servidor: {meta.data.publicApiUrl}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      <h3 className="subhead">Crea un terminal</h3>
      <TerminalForm
        pos={pos.data ?? []}
        submitLabel="Crea el terminal"
        onSubmit={async (body) => {
          await api.post(`/events/${eventId}/terminals`, body);
          reload();
        }}
      />
      {editing && (
        <Modal title={`Edita ${editing.name}`} onClose={() => setEditing(null)}>
          <TerminalForm
            initial={editing}
            pos={pos.data ?? []}
            submitLabel="Desa els canvis"
            onSubmit={async (body) => {
              await api.patch(`/events/${eventId}/terminals/${editing.id}`, body);
              setEditing(null);
              reload();
            }}
          />
        </Modal>
      )}
    </Section>
  );
}
