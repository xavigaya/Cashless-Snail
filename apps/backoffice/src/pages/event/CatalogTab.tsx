import { useState } from 'react';
import { POS_KIND_LABELS, POS_KINDS, type PointOfSale, type PosKind, type Product, type Vendor } from '@cashless/shared';
import { api } from '../../api';
import { CsvTools } from '../../csv-tools';
import { Badge, Empty, ErrorBox, Field, Form, Loading, Modal, Money, MoneyInput, Section, useAction, useLoad } from '../../ui';
import { pointsOfSaleCsv, productsCsv, vendorsCsv } from './csvSpecs';
import { useEventContext } from './EventLayout';

/** Demana confirmació i esborra. Si el servidor no ho permet (té moviments), mostra el motiu. */
export function confirmDelete(action: ReturnType<typeof useAction>, label: string, path: string, onDone: () => void) {
  if (!window.confirm(`Segur que vols esborrar ${label}? No es pot desfer.`)) return;
  void action.run(async () => {
    await api.delete(path);
    onDone();
  });
}

export function CatalogTab() {
  const { event } = useEventContext();
  const vendors = useLoad(() => api.get<Vendor[]>(`/events/${event.id}/vendors`), [event.id]);
  const pos = useLoad(() => api.get<PointOfSale[]>(`/events/${event.id}/points-of-sale`), [event.id]);
  const products = useLoad(() => api.get<Product[]>(`/events/${event.id}/products`), [event.id]);

  if (vendors.loading && !vendors.data) return <Loading />;
  const vendorList = vendors.data ?? [];
  const reloadAll = () => {
    void vendors.reload();
    void pos.reload();
    void products.reload();
  };

  return (
    <>
      <VendorsSection eventId={event.id} vendors={vendorList} error={vendors.error} onChange={reloadAll} />
      <PointsOfSaleSection eventId={event.id} vendors={vendorList} items={pos.data ?? []} error={pos.error} onChange={() => void pos.reload()} />
      <ProductsSection eventId={event.id} vendors={vendorList} items={products.data ?? []} error={products.error} onChange={() => void products.reload()} />
    </>
  );
}

// ---------- Venedors ----------

function VendorForm({ initial, submitLabel, onSubmit }: { initial?: Vendor; submitLabel: string; onSubmit: (body: { name: string; commissionBps: number }) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [commission, setCommission] = useState(initial ? String(initial.commissionBps / 100).replace('.', ',') : '0');
  const action = useAction();
  return (
    <Form
      submitLabel={submitLabel}
      busy={action.busy}
      error={action.error}
      onSubmit={async () => {
        const bps = Math.round(Number(commission.replace(',', '.')) * 100);
        if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
          action.setError('La comissió ha de ser un percentatge entre 0 i 100');
          return;
        }
        const ok = await action.run(() => onSubmit({ name, commissionBps: bps }));
        if (ok && !initial) {
          setName('');
          setCommission('0');
        }
      }}
    >
      <Field label="Nom del venedor">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </Field>
      <Field label="Comissió (%)">
        <input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
      </Field>
    </Form>
  );
}

function VendorsSection({ eventId, vendors, error, onChange }: { eventId: string; vendors: Vendor[]; error: string | null; onChange: () => void }) {
  const [editing, setEditing] = useState<Vendor | null>(null);
  const del = useAction();

  return (
    <Section title="Venedors" actions={<CsvTools spec={vendorsCsv(eventId, vendors)} onImported={onChange} />}>
      <p className="muted" style={{ marginTop: -6 }}>
        Cada entitat que ven dins l’esdeveniment. Les vendes es liquiden per separat per a cada venedor.
      </p>
      <ErrorBox message={error ?? del.error} />
      {vendors.length === 0 ? (
        <Empty>Afegeix el primer venedor per poder crear barres i productes.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th className="num">Comissió del servei</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td className="num">{(v.commissionBps / 100).toLocaleString('ca-ES')} %</td>
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => setEditing(v)}>
                        Edita
                      </button>
                      <button className="link danger" onClick={() => confirmDelete(del, `el venedor «${v.name}»`, `/events/${eventId}/vendors/${v.id}`, onChange)}>
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
      <h3 className="subhead">Afegeix un venedor</h3>
      <VendorForm
        submitLabel="Afegeix el venedor"
        onSubmit={async (body) => {
          await api.post(`/events/${eventId}/vendors`, body);
          onChange();
        }}
      />
      {editing && (
        <Modal title={`Edita ${editing.name}`} onClose={() => setEditing(null)}>
          <VendorForm
            initial={editing}
            submitLabel="Desa els canvis"
            onSubmit={async (body) => {
              await api.patch(`/events/${eventId}/vendors/${editing.id}`, body);
              setEditing(null);
              onChange();
            }}
          />
        </Modal>
      )}
    </Section>
  );
}

// ---------- Punts de venda ----------

function PointOfSaleForm({
  initial,
  vendors,
  submitLabel,
  onSubmit,
}: {
  initial?: PointOfSale;
  vendors: Vendor[];
  submitLabel: string;
  onSubmit: (body: { name: string; kind: PosKind; vendorId?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<PosKind>(initial?.kind ?? 'bar');
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? '');
  const action = useAction();
  return (
    <Form
      submitLabel={submitLabel}
      busy={action.busy}
      error={action.error}
      onSubmit={async () => {
        const ok = await action.run(() => onSubmit({ name, kind, vendorId: kind === 'box_office' ? undefined : vendorId || undefined }));
        if (ok && !initial) setName('');
      }}
    >
      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Barra principal" required minLength={2} />
      </Field>
      <Field label="Tipus" hint={initial ? 'El tipus no es pot canviar' : undefined}>
        <select value={kind} onChange={(e) => setKind(e.target.value as PosKind)} disabled={Boolean(initial)}>
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
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Form>
  );
}

function PointsOfSaleSection(props: { eventId: string; vendors: Vendor[]; items: PointOfSale[]; error: string | null; onChange: () => void }) {
  const [editing, setEditing] = useState<PointOfSale | null>(null);
  const act = useAction();
  const vendorName = (id: string | null) => props.vendors.find((v) => v.id === id)?.name ?? '—';

  return (
    <Section title="Punts de venda" actions={<CsvTools spec={pointsOfSaleCsv(props.eventId, props.items, props.vendors)} onImported={props.onChange} />}>
      <ErrorBox message={props.error ?? act.error} />
      {props.items.length === 0 ? (
        <Empty>Cap punt de venda encara.</Empty>
      ) : (
        <div className="table-wrap">
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
                  <td>{vendorName(p.vendorId)}</td>
                  <td>{p.active ? <Badge tone="good">Actiu</Badge> : <Badge>Inactiu</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => setEditing(p)}>
                        Edita
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          void act.run(async () => {
                            await api.patch(`/events/${props.eventId}/points-of-sale/${p.id}`, { active: !p.active });
                            props.onChange();
                          })
                        }
                      >
                        {p.active ? 'Desactiva' : 'Activa'}
                      </button>
                      <button
                        className="link danger"
                        onClick={() => confirmDelete(act, `el punt de venda «${p.name}»`, `/events/${props.eventId}/points-of-sale/${p.id}`, props.onChange)}
                      >
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
      <h3 className="subhead">Afegeix un punt de venda</h3>
      <PointOfSaleForm
        vendors={props.vendors}
        submitLabel="Afegeix el punt de venda"
        onSubmit={async (body) => {
          await api.post(`/events/${props.eventId}/points-of-sale`, body);
          props.onChange();
        }}
      />
      {editing && (
        <Modal title={`Edita ${editing.name}`} onClose={() => setEditing(null)}>
          <PointOfSaleForm
            initial={editing}
            vendors={props.vendors}
            submitLabel="Desa els canvis"
            onSubmit={async ({ name, vendorId }) => {
              await api.patch(`/events/${props.eventId}/points-of-sale/${editing.id}`, { name, vendorId });
              setEditing(null);
              props.onChange();
            }}
          />
        </Modal>
      )}
    </Section>
  );
}

// ---------- Productes ----------

const VAT_OPTIONS = [
  { bps: 1000, label: '10 %' },
  { bps: 2100, label: '21 %' },
  { bps: 400, label: '4 %' },
  { bps: 0, label: 'Exempt' },
];

interface ProductBody {
  vendorId: string;
  name: string;
  priceCents: number;
  vatRateBps: number;
  category: string;
  color: string;
  destination: 'bar' | 'kitchen';
  sortOrder: number;
}

function ProductForm({
  initial,
  vendors,
  submitLabel,
  onSubmit,
}: {
  initial?: Product;
  vendors: Vendor[];
  submitLabel: string;
  onSubmit: (body: ProductBody) => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState<number | null>(initial?.priceCents ?? null);
  const [vat, setVat] = useState(initial?.vatRateBps ?? 1000);
  const [category, setCategory] = useState(initial?.category ?? 'Begudes');
  const [color, setColor] = useState(initial?.color ?? '#3B6FB6');
  const [destination, setDestination] = useState<'bar' | 'kitchen'>(initial?.destination ?? 'bar');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const action = useAction();
  const vatOptions = VAT_OPTIONS.some((o) => o.bps === vat) ? VAT_OPTIONS : [...VAT_OPTIONS, { bps: vat, label: `${vat / 100} %` }];

  return (
    <Form
      submitLabel={submitLabel}
      busy={action.busy}
      error={action.error}
      onSubmit={async () => {
        if (!price || price <= 0) {
          action.setError('Indica un preu');
          return;
        }
        const ok = await action.run(() =>
          onSubmit({ vendorId, name, priceCents: price, vatRateBps: vat, category, color, destination, sortOrder: Number(sortOrder) || 0 }),
        );
        if (ok && !initial) setName('');
      }}
    >
      <Field label="Venedor" hint={initial ? 'El venedor no es pot canviar' : undefined}>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required disabled={Boolean(initial)}>
          <option value="">Tria’n un…</option>
          {vendors.map((v) => (
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
          {vatOptions.map((o) => (
            <option key={o.bps} value={o.bps}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Categoria">
        <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} />
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
      <Field label="Ordre" hint="Els botons del TPV s’ordenen per aquest número">
        <input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </Field>
    </Form>
  );
}

function ProductsSection(props: { eventId: string; vendors: Vendor[]; items: Product[]; error: string | null; onChange: () => void }) {
  const [editing, setEditing] = useState<Product | null>(null);
  const act = useAction();

  return (
    <Section title="Productes" actions={<CsvTools spec={productsCsv(props.eventId, props.items, props.vendors)} onImported={props.onChange} />}>
      <ErrorBox message={props.error ?? act.error} />
      {props.vendors.map((vendor) => {
        const items = props.items.filter((p) => p.vendorId === vendor.id);
        return (
          <div key={vendor.id} style={{ marginBottom: 18 }}>
            <h3 className="subhead">{vendor.name}</h3>
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
                      <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                        <td>
                          <span className="swatch" style={{ background: p.color }} />
                          {p.name}
                          {!p.active && (
                            <>
                              {' '}
                              <Badge>retirat</Badge>
                            </>
                          )}
                        </td>
                        <td>{p.category}</td>
                        <td>{p.destination === 'kitchen' ? 'Cuina' : 'Barra'}</td>
                        <td className="num">{(p.vatRateBps / 100).toLocaleString('ca-ES')} %</td>
                        <td className="num">
                          <Money cents={p.priceCents} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="link" onClick={() => setEditing(p)}>
                              Edita
                            </button>
                            <button
                              className="link"
                              onClick={() =>
                                void act.run(async () => {
                                  await api.patch(`/events/${props.eventId}/products/${p.id}`, { active: !p.active });
                                  props.onChange();
                                })
                              }
                            >
                              {p.active ? 'Retira' : 'Recupera'}
                            </button>
                            <button
                              className="link danger"
                              onClick={() => confirmDelete(act, `el producte «${p.name}»`, `/events/${props.eventId}/products/${p.id}`, props.onChange)}
                            >
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
          </div>
        );
      })}

      {props.vendors.length > 0 && (
        <>
          <h3 className="subhead">Afegeix un producte</h3>
          <ProductForm
            vendors={props.vendors}
            submitLabel="Afegeix el producte"
            onSubmit={async (body) => {
              await api.post(`/events/${props.eventId}/products`, body);
              props.onChange();
            }}
          />
        </>
      )}
      {editing && (
        <Modal title={`Edita ${editing.name}`} onClose={() => setEditing(null)}>
          <ProductForm
            initial={editing}
            vendors={props.vendors}
            submitLabel="Desa els canvis"
            onSubmit={async ({ vendorId: _vendorId, ...body }) => {
              await api.patch(`/events/${props.eventId}/products/${editing.id}`, body);
              setEditing(null);
              props.onChange();
            }}
          />
        </Modal>
      )}
    </Section>
  );
}
