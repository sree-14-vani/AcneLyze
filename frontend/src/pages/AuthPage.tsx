import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { AuthFailure, useAuth } from '../context/AuthContext';
import type { AuthErrorCode } from '../context/AuthContext';
import { useI18n } from '../lib/i18n';
import { Button, Card, Logo } from '../components/UI';
import { useApp } from '../context/AppContext';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

const ERROR_KEYS: Record<AuthErrorCode, string> = {
  invalid_credentials: 'invalidCredentials',
  account_exists: 'accountExists',
  user_not_found: 'userNotFound',
  invalid_code: 'invalidCode',
  weak_password: 'weakPassword',
  invalid_email: 'invalidEmail',
  generic: 'error',
};

export default function AuthPage({ mode }: { mode: Mode }) {
  const { t } = useI18n();
  const { signIn, signUp, resetPassword, confirmReset, mode: authMode } = useAuth();
  const { pushToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { email?: string } | null;
    if (mode === 'reset' && state?.email) setEmail(state.email);
  }, [location.state, mode]);

  const title = {
    login: 'signIn',
    register: 'signUp',
    forgot: 'forgotPassword',
    reset: 'resetPassword',
  }[mode];

  const describeError = (caught: unknown) => {
    if (caught instanceof AuthFailure) {
      return caught.code === 'generic'
        ? caught.message
        : t(ERROR_KEYS[caught.code]);
    }
    return caught instanceof Error ? caught.message : t('error');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate('/app');
      } else if (mode === 'register') {
        if (password !== confirm) throw new AuthFailure('generic', t('passwordsDiffer'));
        await signUp(email, password, name);
        navigate('/app');
      } else if (mode === 'forgot') {
        const returnedCode = await resetPassword(email);
        if (returnedCode) {
          setDemoCode(returnedCode);
          setInfo(`${t('demoCode')}: ${returnedCode}`);
        } else {
          setInfo(t('emailSent'));
        }
      } else {
        if (password !== confirm) throw new AuthFailure('generic', t('passwordsDiffer'));
        await confirmReset(email, code, password);
        setInfo(t('resetComplete'));
        window.setTimeout(() => navigate('/login'), 1600);
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const continueDemo = async () => {
    setBusy(true);
    try {
      const suffix = Math.random().toString(36).slice(2, 8);
      const demoEmail = `demo-${suffix}@acnelyze.local`;
      await signUp(demoEmail, `Demo@${suffix}123`, 'Demo User');
      pushToast(t('demoSaveNote'), 'info');
      navigate('/app');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-fade flex min-h-screen items-center justify-center bg-powder/40 px-5 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-7 flex justify-center">
          <Logo />
        </div>
        <Card className="shadow-float">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-coral">AcneLyze</p>
          <h1 className="mt-2 text-center font-display text-[26px] font-semibold text-ink">{t(title)}</h1>
          <p className="muted mt-2 text-center text-[13px]">
            {mode === 'register' ? t('privacyNote') : t('tagline')}
          </p>

          {authMode === 'demo' && mode !== 'reset' && (
            <div className="mt-5 rounded-xl border border-peach/70 bg-peach/30 p-3 text-xs leading-relaxed text-ink/80">
              <strong className="font-semibold">{t('demoMode')}.</strong> {t('demoNotice')}
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === 'register' && (
              <div>
                <label className="label" htmlFor="name">
                  {t('fullName')}
                </label>
                <div className="relative">
                  <UserRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    id="name"
                    className="field pl-9"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
              </div>
            )}

            {(mode !== 'reset' || authMode === 'demo') && (
              <div>
                <label className="label" htmlFor="email">
                  {t('email')}
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    id="email"
                    type="email"
                    className="field pl-9"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
            )}

            {mode === 'reset' && (
              <div>
                <label className="label" htmlFor="code">
                  {t('demoCode')}
                </label>
                <input
                  id="code"
                  className="field text-center tracking-[0.4em]"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  required
                  autoFocus
                />
                {demoCode && (
                  <p className="mt-1.5 text-[11px] text-muted">
                    {t('demoCode')}: <span className="font-bold text-ink">{demoCode}</span>
                  </p>
                )}
              </div>
            )}

            {(mode === 'login' || mode === 'register' || mode === 'reset') && (
              <div>
                <label className="label" htmlFor="password">
                  {mode === 'reset' ? t('newPassword') : t('password')}
                </label>
                <div className="relative">
                  <LockKeyhole size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    id="password"
                    type="password"
                    className="field pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'login' ? 1 : 8}
                    required
                  />
                </div>
              </div>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <div>
                <label className="label" htmlFor="confirm">
                  {t('confirmPassword')}
                </label>
                <input
                  id="confirm"
                  type="password"
                  className="field"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                {info}
              </p>
            )}

            {mode === 'forgot' && demoCode && (
              <Button
                type="button"
                variant="soft"
                className="w-full"
                onClick={() => navigate('/reset-password', { state: { email: email.trim() } })}
              >
                {t('continueToReset')}
              </Button>
            )}

            <Button type="submit" loading={busy} className="w-full py-3">
              {t(mode === 'login' ? 'login' : mode === 'register' ? 'register' : mode === 'forgot' ? 'resetPassword' : 'resetPassword')}
            </Button>
          </form>

          {mode === 'login' && (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] text-muted">
                <span className="h-px flex-1 bg-line" /> OR <span className="h-px flex-1 bg-line" />
              </div>
              <Button variant="soft" className="w-full" onClick={continueDemo} disabled={busy}>
                {t('continueDemo')}
              </Button>
              <div className="mt-4 flex justify-between text-xs">
                <Link to="/forgot-password" className="font-medium text-plum hover:underline">
                  {t('forgotPassword')}
                </Link>
                <Link to="/register" className="font-medium text-muted hover:text-ink">
                  {t('noAccount')} {t('register')}
                </Link>
              </div>
            </>
          )}
          {mode === 'register' && (
            <p className="mt-5 text-center text-xs text-muted">
              {t('haveAccount')}{' '}
              <Link to="/login" className="font-semibold text-plum hover:underline">
                {t('login')}
              </Link>
            </p>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <p className="mt-5 text-center text-xs text-muted">
              <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-plum hover:underline">
                <ArrowLeft size={13} /> {t('backHome')}
              </Link>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
