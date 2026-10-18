/** Components i ganxos petits reutilitzats a totes les pantalles. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { formatEuros, parseEuros } from '@cashless/shared';
import { errorMessage } from './api';

/** Carrega dades i permet recarregar-les. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Executa una acció (p. ex. enviar un formulari) i en gestiona l'estat d'error i d'espera. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, busy, run, setError };
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="error" role="alert">
      {message}
    </div>
  );
}

export function Loading({ what = 'Carregant…' }: { what?: string }) {
  return <p className="muted">{what}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Form({
  onSubmit,
  children,
  submitLabel,
  busy,
  error,
}: {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
}) {
  const handle = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit();
  };
  return (
    <form className="form" onSubmit={handle}>
      <div className="form-fields">{children}</div>
      <ErrorBox message={error ?? null} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Desant…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Camp per a imports en euros que treballa internament en cèntims. */
export function MoneyInput({ cents, onChange, required }: { cents: number | null; onChange: (cents: number | null) => void; required?: boolean }) {
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));
  return (
    <input
      inputMode="decimal"
      value={text}
      required={required}
      placeholder="0,00"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseEuros(e.target.value));
      }}
    />
  );
}

export function Money({ cents }: { cents: number }) {
  return <span className="money">{formatEuros(cents)}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ca-ES', { dateStyle: 'short', timeStyle: 'short' });
}

/** Data ISO -> valor per a <input type="datetime-local"> en hora local. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
