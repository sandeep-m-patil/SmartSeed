import { useState, type FormEvent } from 'react';
import { ApiError } from './api';
import { useAuth } from './auth';

const inputClass = 'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

export function LoginPage() {
  const { step, signIn, submitCode } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setIsBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsBusy(false);
    }
  }

  const onCredentials = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(() => signIn(String(form.get('email')), String(form.get('password'))));
  };

  const onCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void run(() => submitCode(String(new FormData(e.currentTarget).get('code'))));
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold text-brand-700">SmartSeed</h1>
      <p className="mb-6 text-sm text-slate-600">Sign in to your organization account.</p>
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {step.kind === 'credentials' ? (
        <form onSubmit={onCredentials} className="space-y-4">
          <label className="block text-sm font-medium">Email
            <input name="email" type="email" autoComplete="username" required className={inputClass} />
          </label>
          <label className="block text-sm font-medium">Password
            <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
          </label>
          <button disabled={isBusy} className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {isBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={onCode} className="space-y-4">
          {step.enrollment && (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium">Set up your authenticator app</p>
              <p className="mt-1">Add this key to your authenticator, then enter the 6-digit code.</p>
              <code className="mt-2 block break-all rounded bg-slate-100 p-2">{step.enrollment.secret}</code>
            </div>
          )}
          <label className="block text-sm font-medium">Authentication code
            <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required className={inputClass} />
          </label>
          <button disabled={isBusy} className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {isBusy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
    </main>
  );
}
