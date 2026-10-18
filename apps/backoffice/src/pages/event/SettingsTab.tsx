import { useState } from 'react';
import { EVENT_STATUS_LABELS, EVENT_STATUSES, type EventStatus } from '@cashless/shared';
import { api } from '../../api';
import { Field, Form, fromLocalInput, MoneyInput, Section, toLocalInput, useAction } from '../../ui';
import { useEventContext } from './EventLayout';

export function SettingsTab() {
  const { event, reloadEvent } = useEventContext();
  const [name, setName] = useState(event.name);
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.endsAt));
  const [price, setPrice] = useState<number | null>(event.wristbandPriceCents);
  const [deposit, setDeposit] = useState<number | null>(event.wristbandDepositCents);
  const [maxBalance, setMaxBalance] = useState<number | null>(event.maxBalanceCents);
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();

  return (
    <Section title="Configuració de l’esdeveniment">
      <Form
        submitLabel="Desa els canvis"
        busy={busy}
        error={error}
        onSubmit={async () => {
          setSaved(false);
          const ok = await run(() =>
            api.patch(`/events/${event.id}`, {
              name,
              status,
              startsAt: fromLocalInput(startsAt),
              endsAt: fromLocalInput(endsAt),
              wristbandPriceCents: price ?? 0,
              wristbandDepositCents: deposit ?? 0,
              maxBalanceCents: maxBalance ?? event.maxBalanceCents,
            }),
          );
          if (ok) {
            setSaved(true);
            await reloadEvent();
          }
        }}
      >
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Estat" hint="Només en estat «Actiu» els terminals poden operar">
          <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inici">
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </Field>
        <Field label="Final">
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
        </Field>
        <Field label="Preu de la polsera (€)">
          <MoneyInput cents={price} onChange={setPrice} />
        </Field>
        <Field label="Fiança (€)">
          <MoneyInput cents={deposit} onChange={setDeposit} />
        </Field>
        <Field label="Saldo màxim per polsera (€)">
          <MoneyInput cents={maxBalance} onChange={setMaxBalance} required />
        </Field>
      </Form>
      {saved && <p className="muted">Canvis desats.</p>}
    </Section>
  );
}
