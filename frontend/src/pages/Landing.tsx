import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  Check,
  HeartPulse,
  Leaf,
  MessageCircleHeart,
  ScanFace,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../lib/i18n';
import type { Language } from '../types';
import { Button, Card, Logo } from '../components/UI';

const FEATURES = [
  {
    icon: ScanFace,
    title: 'featureAnalyze',
    body: 'featureAnalyzeSub',
    tint: 'bg-powder text-sky',
  },
  {
    icon: Camera,
    title: 'featureEnhance',
    body: 'featureEnhanceSub',
    tint: 'bg-peach text-coral',
  },
  {
    icon: Leaf,
    title: 'featurePlan',
    body: 'featurePlanSub',
    tint: 'bg-powder text-ink',
  },
  {
    icon: MessageCircleHeart,
    title: 'featureChat',
    body: 'featureChatSub',
    tint: 'bg-peach text-coral',
  },
];

const STEPS = ['journey1', 'journey2', 'journey3', 'journey4', 'journey5'];

export default function Landing() {
  const { t, language, setLanguage } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <Logo />
          <nav className="ml-auto hidden items-center gap-7 text-sm font-medium text-muted md:flex">
            <a href="#features" className="transition hover:text-ink">
              {t('featureAnalyze')}
            </a>
            <a href="#journey" className="transition hover:text-ink">
              {t('journey')}
            </a>
            <Link to="/app/profile" className="transition hover:text-ink">
              {t('settings')}
            </Link>
          </nav>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            className="ml-auto rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink md:ml-0"
            aria-label={t('language')}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="kn">ಕನ್ನಡ</option>
            <option value="te">తెలుగు</option>
          </select>
          <Button
            variant="soft"
            className="px-3 py-2 text-xs sm:px-4 sm:text-sm"
            onClick={() => navigate(user ? '/app' : '/login')}
          >
            {user ? t('navOverview') : t('login')}
          </Button>
        </div>
      </header>

      <main>
        <section className="grid-fade border-b border-line/80">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-peach bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-coral">
                <HeartPulse size={13} /> {t('heroEyebrow')}
              </div>
              <h1 className="max-w-xl font-display text-[38px] font-semibold leading-[1.1] text-ink sm:text-[54px]">
                {t('heroTitle')}
              </h1>
              <p className="muted mt-6 max-w-xl text-[15px]">{t('heroSub')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button onClick={() => navigate(user ? '/app' : '/register')} className="px-6 py-3">
                  {t('getStarted')} <ArrowRight size={17} />
                </Button>
                <Button
                  variant="soft"
                  className="px-6 py-3"
                  onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  {t('seeHow')}
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-muted">
                <ShieldCheck size={15} className="text-coral" />
                <span>{t('privacyNote')}</span>
              </div>
            </div>

            <Card className="shadow-float">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-coral">
                    Workspace preview
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold text-ink">
                    {t('tagline')}
                  </p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-peach text-coral">
                  <Sparkles size={19} />
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  { icon: ScanFace, label: t('navSkinDiseaseAnalysis'), detail: t('featureAnalyze') },
                  { icon: Camera, label: t('navEnhance'), detail: t('featureEnhance') },
                  { icon: Leaf, label: t('navDiet'), detail: t('featurePlan') },
                ].map(({ icon: Icon, label, detail }) => (
                  <div key={label} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-powder text-sky">
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{label}</p>
                      <p className="truncate text-[11px] text-muted">{detail}</p>
                    </div>
                    <Check size={16} className="shrink-0 text-coral" />
                  </div>
                ))}
              </div>
              <p className="muted mt-5 text-center text-[11px]">{t('scoreScale')}</p>
            </Card>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-coral">AcneLyze</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">
              {t('tagline')}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body, tint }) => (
              <Card key={title} className="transition hover:border-coral/30">
                <div className={`mb-5 flex h-11 w-11 items-center justify-center rounded-xl ${tint}`}>
                  <Icon size={21} />
                </div>
                <h3 className="font-display text-xl font-semibold text-ink">{t(title)}</h3>
                <p className="muted mt-2.5 text-[13px]">{t(body)}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="journey" className="border-y border-line bg-powder/60 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">{t('journey')}</h2>
            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((step, index) => (
                <Card key={step} className="py-5">
                  <span className="font-display text-3xl font-semibold text-line">0{index + 1}</span>
                  <p className="mt-3 text-sm font-semibold leading-snug text-ink">{t(step)}</p>
                </Card>
              ))}
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/register')}>
                {t('register')} <ArrowRight size={16} />
              </Button>
              <Link to="/login" className="btn-ghost">
                {t('login')}
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-6 rounded-card bg-ink p-7 text-white sm:flex-row sm:items-center sm:p-9">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-peach">AcneLyze</p>
              <h2 className="mt-2 max-w-xl font-display text-2xl font-semibold sm:text-3xl">
                {t('tagline')}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate(user ? '/app' : '/register')}
              className="btn bg-white text-ink hover:bg-powder"
            >
              {t('getStarted')} <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-8 text-xs text-muted sm:px-8">
        <Logo compact />
        <p className="max-w-xl text-right leading-relaxed">{t('disclaimer')}</p>
      </footer>
    </div>
  );
}
