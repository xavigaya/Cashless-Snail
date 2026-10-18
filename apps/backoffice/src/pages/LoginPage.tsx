import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../session';
import { Field, Form, useAction } from '../ui';

export function LoginPage() {
  const { user, login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="login">
      <div className="section">
        <h1>
          Cashless <span style={{ color: 'var(--accent)' }}>Snail</span>
        </h1>
        <Form onSubmit={() => run(() => login(email, password))} submitLabel="Entra" busy={busy} error={error}>
          <Field label="Correu electrònic">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Contrasenya">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </Form>
      </div>
    </div>
  );
}
