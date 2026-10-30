import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../session';
import { SnailSymbol, Wordmark } from '../Logo';
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
        <div className="login-brand">
          <SnailSymbol size={180} ink="currentColor" />
          <Wordmark size={34} />
          <div className="login-tagline">Accés · Aforament · Pagaments</div>
        </div>
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
