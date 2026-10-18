import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EVENT_STATUS_LABELS,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  type EventSummary,
  type Organization,
  type TaxRegime,
} from '@cashless/shared';
import { api } from '../api';
import { useSession } from '../session';
import { Badge, Empty, ErrorBox, Field, Form, fromLocalInput, Loading, MoneyInput, Section, useAction, useLoad } from '../ui';

export function HomePage() {
  const { isPlatformAdmin } = useSession();
  const orgs = useLoad(() => api.get<Organization[]>('/organizations'), []);
  const events = useLoad(() => api.get<EventSummary[]>('/events'), []);
  const [showNewOrg, setShowNewOrg] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Entitats i esdeveniments</h1>
          <p>Tria un esdeveniment per configurar-lo o veure’n l’activitat.</p>
        </div>
        {isPlatformAdmin && (
          <button className="primary" onClick={() => setShowNewOrg((v) => !v)}>
            Nova entitat
          </button>
        )}
      </div>

      {showNewOrg && (
        <NewOrganization
          onCreated={() => {
            setShowNewOrg(false);
            void orgs.reload();
          }}
        />
      )}

      <ErrorBox message={orgs.error ?? events.error} />
      {orgs.loading && <Loading />}
      {orgs.data?.length === 0 && <Empty>Encara no tens accés a cap entitat.</Empty>}

      {orgs.data?.map((org) => (
        <OrganizationBlock
          key={org.id}
          org={org}
          events={(events.data ?? []).filter((e) => e.organizationId === org.id)}
          onChange={() => void events.reload()}
        />
      ))}
    </>
  );
}

function OrganizationBlock({ org, events, onChange }: { org: Organization; events: EventSummary[]; onChange: () => void }) {
  const { canManageOrganization } = useSession();
  const [mode, setMode] = useState<'none' | 'event' | 'admin'>('none');
  const canManage = canManageOrganization(org.id);

  return (
    <Section
      title={org.name}
      actions={
        canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setMode(mode === 'admin' ? 'none' : 'admin')}>Afegeix administrador</button>
            <button className="primary" onClick={() => setMode(mode === 'event' ? 'none' : 'event')}>
              Nou esdeveniment
            </button>
          </div>
        )
      }
    >
      <p className="muted" style={{ marginTop: -8 }}>
        {TAX_REGIME_LABELS[org.taxRegime]}
        {org.taxId ? ` · ${org.taxId}` : ''}
      </p>

      {mode === 'event' && (
        <NewEvent
          orgId={org.id}
          onCreated={() => {
            setMode('none');
            onChange();
          }}
        />
      )}
      {mode === 'admin' && <NewOrgAdmin orgId={org.id} onCreated={() => setMode('none')} />}

      {events.length === 0 ? (
        <Empty>Cap esdeveniment encara.</Empty>
      ) : (
        <div className="cards">
          {events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="card">
              <h3>{e.name}</h3>
              <div className="muted">
                {new Date(e.startsAt).toLocaleDateString('ca-ES')} – {new Date(e.endsAt).toLocaleDateString('ca-ES')}
              </div>
              <div style={{ marginTop: 8 }}>
                <Badge tone={e.status === 'active' ? 'good' : e.status === 'closed' ? 'neutral' : 'warn'}>{EVENT_STATUS_LABELS[e.status]}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

function NewOrganization({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegime>('association');
  const { error, busy, run } = useAction();

  return (
    <Section title="Nova entitat">
      <Form
        submitLabel="Crea l’entitat"
        busy={busy}
        error={error}
        onSubmit={async () => {
          if (await run(() => api.post('/organizations', { name, taxId: taxId || undefined, taxRegime }))) onCreated();
        }}
      >
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="NIF">
          <input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </Field>
        <Field label="Tipus">
          <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}>
            {TAX_REGIMES.map((r) => (
              <option key={r} value={r}>
                {TAX_REGIME_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      </Form>
    </Section>
  );
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function NewEvent({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [price, setPrice] = useState<number | null>(0);
  const [deposit, setDeposit] = useState<number | null>(0);
  const [maxBalance, setMaxBalance] = useState<number | null>(20000);
  const { error, busy, run } = useAction();

  return (
    <Form
      submitLabel="Crea l’esdeveniment"
      busy={busy}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/organizations/${orgId}/events`, {
            name,
            slug: slug || slugify(name),
            startsAt: fromLocalInput(startsAt),
            endsAt: fromLocalInput(endsAt),
            wristbandPriceCents: price ?? 0,
            wristbandDepositCents: deposit ?? 0,
            maxBalanceCents: maxBalance ?? 20000,
          }),
        );
        if (ok) onCreated();
      }}
    >
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Identificador web" hint="S’usarà a la URL pública de l’esdeveniment">
        <input value={slug} placeholder={slugify(name) || 'festa-major-2027'} onChange={(e) => setSlug(e.target.value)} />
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
  );
}

function NewOrgAdmin({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();

  return (
    <Form
      submitLabel="Afegeix l’administrador"
      busy={busy}
      error={error}
      onSubmit={async () => {
        if (await run(() => api.post(`/organizations/${orgId}/admins`, { email, name, password }))) onCreated();
      }}
    >
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Correu">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Contrasenya inicial" hint="Mínim 10 caràcters. Si l’usuari ja existeix, es manté la seva.">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required />
      </Field>
    </Form>
  );
}
