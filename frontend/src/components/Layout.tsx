import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Apple,
  Bell,
  CalendarCheck,
  ChevronDown,
  FileText,
  Globe2,
  History,
  LayoutDashboard,
  Package,
  Lightbulb,
  LogOut,
  Menu,
  MessageCircle,
  ScanFace,
  Sparkles,
  UtensilsCrossed,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useI18n } from '../lib/i18n';
import type { Language } from '../types';
import { Logo } from './UI';

const NAV = [
  { to: '/app', key: 'navOverview', icon: LayoutDashboard, end: true },
  { to: '/app/analyze', key: 'navSkinDiseaseAnalysis', icon: ScanFace, end: false },
  { to: '/app/tips', key: 'navTips', icon: Lightbulb, end: false },
  { to: '/app/products', key: 'navProducts', icon: Package, end: false },
  { to: '/app/diet', key: 'navDiet', icon: UtensilsCrossed, end: false },
  { to: '/app/enhance', key: 'navEnhance', icon: Sparkles, end: false },
  { to: '/app/chat', key: 'navChat', icon: MessageCircle, end: false },
  { to: '/app/reminders', key: 'navReminders', icon: Bell, end: false },
  { to: '/app/routine', key: 'navRoutine', icon: CalendarCheck, end: false },
  { to: '/app/history', key: 'navHistory', icon: History, end: false },
  { to: '/app/nutrition', key: 'navNutrition', icon: Apple, end: false },
  { to: '/app/report', key: 'navReport', icon: FileText, end: false },
  { to: '/app/profile', key: 'navProfile', icon: UserRound, end: false },
] as const;

export default function Layout() {
  const { t, language, setLanguage } = useI18n();
  const { user, signOut, mode } = useAuth();
  const { updatePreferences, profile, apiConfig, apiConfigLoading } = useApp();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const current = NAV.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );
  const pageTitle = current ? t(current.key) : t('appName');

  const changeLanguage = async (next: Language) => {
    setLanguage(next);
    if (user) {
      try {
        await updatePreferences({ language: next });
      } catch {
        // The local language choice still applies.
      }
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-6 pt-5">
        <Logo />
        <button
          className="rounded-lg p-1.5 text-muted hover:bg-line lg:hidden"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted/80">
          {t('account')}
        </p>
        <nav className="space-y-1">
          {NAV.map(({ to, key, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-powder text-ink shadow-sm'
                    : 'text-muted hover:bg-powder hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={isActive ? 'text-ink' : 'text-muted/80'} />
                  <span>{t(key)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-powder px-3 py-2.5 text-xs text-ink">
          {apiConfig || apiConfigLoading
            ? <ScanFace size={15} className="text-sky" />
            : <WifiOff size={15} className="text-coral" />}
          <span className="flex-1 leading-snug">
            {apiConfig
              ? t(apiConfig.features.chat_available ? 'geminiOn' : 'geminiOff')
              : apiConfigLoading
                ? t('connecting')
                : t('error')}
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut size={17} />
          {t('logout')}
        </button>
        <p className="px-3 pt-2 text-[10px] text-muted/70">
          {mode === 'demo' ? t('demoMode') : 'Cloud sync active'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fbfcfe]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[254px] border-r border-line bg-white lg:block">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label={t('close')}
          />
          <aside className="absolute inset-y-0 left-0 w-[270px] bg-white shadow-float">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-[254px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur-md sm:px-6">
          <button
            className="rounded-xl p-2 text-ink hover:bg-powder/60 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold text-ink">{pageTitle}</p>
          </div>

          <div className="relative">
            <Globe2 size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <select
              value={language}
              onChange={(event) => void changeLanguage(event.target.value as Language)}
              className="appearance-none rounded-xl border border-line bg-white py-2 pl-8 pr-7 text-xs font-semibold text-ink outline-none focus:border-sky"
              aria-label={t('language')}
            >
              <option value="en">English</option>
              <option value="hi">à¤¹à¤¿à¤¨à¥à¤¦à¥€</option>
              <option value="kn">à²•à²¨à³à²¨à²¡</option>
              <option value="te">à°¤à±†à°²à±à°—à±</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
          </div>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-xl border border-line bg-white py-1 pl-1 pr-2 hover:border-powder"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-powder text-sm font-bold text-ink">
                {(profile?.full_name || user?.name || 'A').charAt(0).toUpperCase()}
              </span>
              <ChevronDown size={14} className="text-muted" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-12 z-40 w-56 rounded-2xl border border-line bg-white p-2 shadow-float">
                <div className="border-b border-line px-2.5 py-2">
                  <p className="truncate text-sm font-semibold text-ink">
                    {profile?.full_name || user?.name}
                  </p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                </div>
                <NavLink
                  to="/app/profile"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-powder/50 hover:text-ink"
                >
                  <UserRound size={15} /> {t('profile')}
                </NavLink>
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted hover:bg-rose-50 hover:text-rose-600"
                >
                  <LogOut size={15} /> {t('logout')}
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <Outlet />
        </main>

        <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-2 px-4 pb-8 text-[11px] text-muted/80 sm:px-6 lg:px-10">
          <span>AcneLyze · {t('disclaimer')}</span>
          <span>{mode === 'demo' ? t('localOnly') : 'Cloud sync active'}</span>
        </footer>
      </div>
    </div>
  );
}
