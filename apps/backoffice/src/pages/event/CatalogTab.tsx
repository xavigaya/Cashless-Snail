import { useState } from 'react';
import { POS_KIND_LABELS, POS_KINDS, type PointOfSale, type PosKind, type Product, type Vendor } from '@cashless/shared';
import { api } from '../../api';
import { Badge, Empty, ErrorBox, Field, Form, Loading, Money, MoneyInput, Section, useAction, useLoad } from '../../ui';
import { useEventContext } from './EventLayout';

export function CatalogTab() {
  const { event } = useEventContext();
  const vendors = useLoad(() => api.get<Vendor[]>(`/events/${event.id}/vendors`), [event.id]);
  const pos = useLoad(() => api.get<PointOfSale[]>(`/events/${event.id}/points-of-sale`), [event.id]);
  const products = useLoad(() => api.get<Product[]>(`/events/${event.id}/products`), [event.id]);

  if (vendors.loading && !vendors.data) return <Loading />;
  const vendorList = vendors.data ?? [];
  const vendorName = (id: string | null) => vendorList.find((v) => v.id === id)?.name ?? '—';

  return (
    <>
      <VendorsSection eventId={event.id} vendors={vendorList} error={vendors.error} onChange={() => void vendors.reload()} />
      <PointsOfSaleSection
        eventId={event.id}
        vendors={vendorList}
        items={pos.data ?? []}
        error={pos.error}
        vendorName={vendorName}
        onChange={() => void pos.reload()}
      />
      <ProductsSection eventId={event.id} vendors={vendorList} items={products.data ?? []} error={products.error} onChange={() => void products.reload()} />
    </>
  );
}

function VendorsSection({ eventId, vendors, error, onChange }: { eventId: string; vendors: Vendor[]; error: string | null; onChange: () => void }) {
  const [name, setName] = useState('');
  const [commission, setCommission] = useState('0');
  const action = useAction();

  return (
    <Section title="Venedors">
      <p className="muted" style={{ marginTop: -6 }}>
        Cada entitat que ven dins l’esdeveniment. Les vendes es liquiden per separat per a cada venedor.
      </p>
      <ErrorBox message={error} />
      {vendors.length === 0 ? (
        <Empty>Afegeix el primer venedor per poder crear barres i productes.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th className="num">Comissió del servei</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td className="num">{(v.commissionBps / 100).toLocaleString('ca-ES')} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Form
        submitLabel="Afegeix el venedor"
        busy={action.busy}
        error={action.error}
        onSubmit={async () => {
          const bps = Math.round(Number(commission.replace(',', '.')) * 100);
          if (await action.run(() => api.post(`/events/${eventId}/vendors`, { name, commissionBps: Number.isFinite(bps) ? bps : 0 }))) {
            setName('');
            setCommission('0');
            onChange();
          }
        }}
      >
        <Field label="Nom del venedor">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Comissió (%)">
          <input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
        </Field>
      </Form>
    </Section>
  );
}

function PointsOfSaleSection(props: {
  eventId: string;
  vendors: Vendor[];
  items: PointOfSale[];
  error: string | null;
  vendorName: (id: string | null) => string;
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PosKind>('bar');
  const [vendorId, setVendorId] = useState('');
  const action = useAction();
  const toggle = useAction();

  return (
    <Section title="Punts de venda">
      <ErrorBox message={props.error ?? toggle.error} />
      {props.items.length === 0 ? (
        <Empty>Cap punt de venda encara.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Tipus</th>
              <th>Venedor</th>
              <th>Estat</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{POS_KIND_LABELS[p.kind]}</td>
                <td>{props.vendorName(p.vendorId)}</td>
                <td>{p.active ? <Badge tone="good">Actiu</Badge> : <Badge>Inactiu</Badge>}</td>
                <td className="num">
                  <button
                    className="link"
                    onClick={() =>
                      void toggle.run(async () => {
                        await api.patch(`/events/${props.eventId}/points-of-sale/${p.id}`, { active: !p.active });
                        props.onChange();
                      })
                    }
                  >
                    {p.active ? 'Desactiva' : 'Activa'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Form
        submitLabel="Afegeix el punt de venda"
        busy={action.busy}
        error={action.error}
        onSubmit={async () => {
          const body = { name, kind, vendorId: kind === 'box_office' ? undefined : vendorId || undefined };
          if (await action.run(() => api.post(`/events/${props.eventId}/points-of-sale`, body))) {
            setName('');
            props.onChange();
          }
        }}
      >
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Barra principal" required />
        </Field>
        <Field label="Tipus">
          <select value={kind} onChange={(e) => setKind(e.target.value as PosKind)}>
            {POS_KINDS.map((k) => (
              <option key={k} value={k}>
                {POS_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind !== 'box_office' && (
          <Field label="Venedor">
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
              <option value="">Tria’n un…</option>
              {props.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Form>
    </Section>
  );
}

const VAT_OPTIONS = [
  { bps: 1000, label: '10 %' },
  { bps: 2100, label: '21 %' },
  { bps: 400, label: '4 %' },
  { bps: 0, label: 'Exempt' },
];

function ProductsSection(props: { eventId: string; vendors: Vendor[]; items: Product[]; error: string | null; onChange: () => void }) {
  const [vendorId, setVendorId] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [vat, setVat] = useState(1000);
  const [category, setCategory] = useState('Begudes');
  const [color, setColor] = useState('#3B6FB6');
  const [destination, setDestination] = useState<'bar' | 'kitchen'>('bar');
  const action = useAction();
  const edit = useAction();

  return (
    <Section title="Productes">
      <ErrorBox message={props.error ?? edit.error} />
      {props.vendors.map((vendor) => {
        const items = props.items.filter((p) => p.vendorId === vendor.id);
        return (
          <div key={vendor.id} style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: '0.95rem', margin: '6px 0' }}>{vendor.name}</h3>
            {items.length === 0 ? (
              <Empty>Sense productes.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producte</th>
                      <th>Categoria</th>
                      <th>Destinació</th>
                      <th className="num">IVA</th>
                      <th className="num">Preu</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                        <td>
                          <span className="swatch" style={{ background: p.color }} />
                          {p.name}
                        </td>
                        <td>{p.category}</td>
                        <td>{p.destination === 'kitchen' ? 'Cuina' : 'Barra'}</td>
                        <td className="num">{p.vatRateBps / 100} %</td>
                        <td className="num">
                          <Money cents={p.priceCents} />
                        </td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <button
                            className="link"
                            onClick={() => {
                              const input = window.prompt(`Nou preu per a ${p.name} (€)`, (p.priceCents / 100).toFixed(2).replace('.', ','));
                              const cents = input ? Math.round(Number(input.replace(',', '.')) * 100) : NaN;
                              if (Number.isFinite(cents) && cents > 0) {
                                void edit.run(async () => {
                                  await api.patch(`/events/${props.eventId}/products/${p.id}`, { priceCents: cents });
                                  props.onChange();
                                });
                              }
                            }}
                          >
                            Canvia el preu
                          </button>
                          {' · '}
                          <button
                            className="link"
                            onClick={() =>
                              void edit.run(async () => {
                                await api.patch(`/events/${props.eventId}/products/${p.id}`, { active: !p.active });
                                props.onChange();
                              })
                            }
                          >
                            {p.active ? 'Retira' : 'Recupera'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {props.vendors.length > 0 && (
        <Form
          submitLabel="Afegeix el producte"
          busy={action.busy}
          error={action.error}
          onSubmit={async () => {
            if (!price) {
              action.setError('Indica un preu');
              return;
            }
            const body = { vendorId, name, priceCents: price, vatRateBps: vat, category, color, destination };
            if (await action.run(() => api.post(`/events/${props.eventId}/products`, body))) {
              setName('');
              props.onChange();
            }
          }}
        >
          <Field label="Venedor">
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
              <option value="">Tria’n un…</option>
              {props.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nom">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </Field>
          <Field label="Preu (€)">
            <MoneyInput cents={price} onChange={setPrice} required />
          </Field>
          <Field label="IVA">
            <select value={vat} onChange={(e) => setVat(Number(e.target.value))}>
              {VAT_OPTIONS.map((o) => (
                <option key={o.bps} value={o.bps}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Color del botó">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label="Destinació">
            <select value={destination} onChange={(e) => setDestination(e.target.value as 'bar' | 'kitchen')}>
              <option value="bar">Barra</option>
              <option value="kitchen">Cuina</option>
            </select>
          </Field>
        </Form>
      )}
    </Section>
  );
}
