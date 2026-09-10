import { useState, type FormEvent } from 'react';

export function LoginPage({ login }: { login(pin: string): Promise<void> }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4,12}$/.test(pin)) {
      setError('Enter a 4–12 digit PIN.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(pin);
      setPin('');
    } catch {
      setError('PIN could not be verified.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-entry" aria-labelledby="login-title">
      <form className="admin-entry__card admin-login" onSubmit={submit}>
        <div className="admin-entry__mark" aria-hidden="true">
          T
        </div>
        <p className="admin-entry__eyebrow">Secure access</p>
        <h1 id="login-title">Enter PIN</h1>
        <p className="admin-entry__copy">Use your individual TUX Admin PIN.</p>
        <label className="admin-login__label" htmlFor="admin-pin">
          PIN
        </label>
        <input
          id="admin-pin"
          className="admin-login__input"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
          inputMode="numeric"
          autoComplete="off"
          type="password"
          minLength={4}
          maxLength={12}
          autoFocus
        />
        {error ? (
          <p className="admin-login__error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="admin-login__submit" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
