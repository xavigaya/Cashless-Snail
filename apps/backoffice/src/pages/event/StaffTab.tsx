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
import { Badge, Empty, ErrorBox, Field, Form, formatDateTime, Section, useAction, useLoad } from '../../ui';
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

function OperatorsSection({ eventId }: { eventId: string }) {
  const operators = useLoad(() => api.get<Operator[]>(`/events/${eventId}/operators`), [eventId]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<OperatorRole>('cashier');
  const action = useAction();
  const edit = useAction();

  const update = (op: Operator, body: object) =>
    void edit.run(async () => {
      await api.patch(`/events/${eventId}/operators/${op.id}`, body);
      await operators.reload();
    });

  return (
    <Section title="Operadors">
      <p className="muted" style={{ marginTop: -6 }}>
        Voluntaris que treballen als terminals. Entren triant el seu nom i escrivint el PIN.
      </p>
      <ErrorBox message={operators.error ?? edit.error} />
      {operators.data?.length === 0 ? (
        <Empty>Cap operador encara.</Empty>
      ) : (
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
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="link"
                    onClick={() => {
                      const newPin = window.prompt(`Nou PIN per a ${op.name} (4 a 6 xifres)`);
                      if (newPin && /^\d{4,6}$/.test(newPin)) update(op, { pin: newPin });
                      else if (newPin) edit.setError('El PIN ha de tenir entre 4 i 6 xifres');
                    }}
                  >
                    Canvia el PIN
                  </button>
                  {' · '}
                  <button className="link" onClick={() => update(op, { active: !op.active })}>
                    {op.active ? 'Desactiva' : 'Activa'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Form
        submitLabel="Afegeix l’operador"
        busy={action.busy}
        error={action.error}
        onSubmit={async () => {
          if (await action.run(() => api.post(`/events/${eventId}/operators`, { name, pin, role }))) {
            setName('');
            setPin('');
            await operators.reload();
          }
        }}
      >
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="PIN" hint="4 a 6 xifres">
          <input inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value)} required />
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
    </Section>
  );
}

function TerminalsSection({ eventId }: { eventId: string }) {
  const terminals = useLoad(() => api.get<Terminal[]>(`/events/${eventId}/terminals`), [eventId]);
  const pos = useLoad(() => api.get<PointOfSale[]>(`/events/${eventId}/points-of-sale`), [eventId]);
  const meta = useLoad(() => api.get<{ publicApiUrl: string }>('/meta'), []);
  const [name, setName] = useState('');
  const [posId, setPosId] = useState('');
  const action = useAction();
  const edit = useAction();

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
    <Section title="Terminals">
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {t.active ? <Badge tone="good">Actiu</Badge> : <Badge tone="bad">Desactivat</Badge>}
              <button onClick={() => act(() => api.post(`/events/${eventId}/terminals/${t.id}/pairing-code`))}>
                {t.pairedAt ? 'Vincula un altre dispositiu' : 'Nou codi'}
              </button>
              <button className={t.active ? 'danger' : ''} onClick={() => act(() => api.patch(`/events/${eventId}/terminals/${t.id}`, { active: !t.active }))}>
                {t.active ? 'Desactiva' : 'Activa'}
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
      <Form
        submitLabel="Crea el terminal"
        busy={action.busy}
        error={action.error}
        onSubmit={async () => {
          if (await action.run(() => api.post(`/events/${eventId}/terminals`, { name, pointOfSaleId: posId }))) {
            setName('');
            await terminals.reload();
          }
        }}
      >
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Barra 1" required />
        </Field>
        <Field label="Punt de venda">
          <select value={posId} onChange={(e) => setPosId(e.target.value)} required>
            <option value="">Tria’n un…</option>
            {pos.data
              ?.filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({POS_KIND_LABELS[p.kind]})
                </option>
              ))}
          </select>
        </Field>
      </Form>
    </Section>
  );
}
