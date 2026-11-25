import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  CalendarCheck,
  Camera,
  Clock3,
  ScanFace,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../lib/i18n';
import { Button, Card, Chip, EmptyState, SectionHeading } from '../components/UI';
import ScoreRing from '../components/ScoreRing';
import { concernLabel } from '../lib/regions';

export default function DashboardPage() {
  const { t, language } = useI18n();
  const { user, mode } = useAuth();
  const {
    profile,
    analyses,
    enhancements,
    latestTips,
    latestDiet,
    reminders,
    routine,
    apiConfig,
    apiConfigLoading,
    loading,
  } = useApp();

  const latestAnalysis = analyses[0];
  const latestEnhancement = enhancements[0];
  const enabledReminders = reminders.filter((item) => item.enabled).length;

  return (
    <div>
      <SectionHeading
        eyebrow={t('overviewGreeting')}
        title={`${t('overviewGreeting')}, ${(profile?.full_name || user?.name || '').split(' ')[0]}.`}
        subtitle={t('overviewSub')}
        action={
          <div className="flex flex-wrap gap-2">
            <Chip tone="blue">{mode === 'demo' ? t('demoMode') : 'Cloud sync active'}</Chip>
            <Chip tone={apiConfig ? 'green' : apiConfigLoading ? 'blue' : 'peach'}>
              {apiConfig
                ? t('geminiOn')
                : apiConfigLoading
                  ? t('connecting')
                  : t('error')}
            </Chip>
          </div>
        }
      />

      <div className="mb-5 flex flex-col justify-between gap-4 rounded-card bg-ink p-6 text-white sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-peach">AcneLyze</p>
          <p className="mt-2 font-display text-xl font-semibold sm:text-2xl">{t('tagline')}</p>
        </div>
        <Link to="/app/analyze" className="btn bg-white text-ink hover:bg-powder">
          <ScanFace size={16} /> {t('startAnalysis')}
        </Link>
      </div>

      {loading && <p className="muted mb-4 text-xs">{t('loading')}</p>}


      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: ScanFace, label: t('navSkinDiseaseAnalysis'), value: analyses.length, to: '/app/analyze', tint: 'bg-powder text-sky' },
          { icon: Sparkles, label: t('navEnhance'), value: enhancements.length, to: '/app/enhance', tint: 'bg-peach text-coral' },

          { icon: CalendarCheck, label: t('navRoutine'), value: routine ? routine.morning.length + routine.night.length : 0, to: '/app/routine', tint: 'bg-powder text-sky' },
          { icon: Bell, label: t('navReminders'), value: enabledReminders, to: '/app/reminders', tint: 'bg-peach text-coral' },

        ].map(({ icon: Icon, label, value, to, tint }) => (
          <Link key={label} to={to} className="card group hover:border-sky/40 hover:shadow-float">
            <div className="flex items-start justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}>
                <Icon size={19} />
              </div>
              <ArrowUpRight size={16} className="text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
            </div>
            <p className="mt-4 font-display text-3xl font-semibold text-ink">{value}</p>
            <p className="muted mt-1 text-xs">{label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card soft>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-ink">{t('latestAnalysis')}</h2>
            <Link to="/app/history" className="text-xs font-semibold text-plum hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          {latestAnalysis ? (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <ScoreRing value={latestAnalysis.overall_score} label={t('overallScore')} size={104} />
              <div className="flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {latestAnalysis.concerns.map((concern) => (
                    <Chip key={concern} tone="peach">
                      {concernLabel(concern, language)}
                    </Chip>
                  ))}
                </div>
                <p className="muted mt-3 flex items-center gap-1.5 text-xs">
                  <Clock3 size={13} />
                  {new Date(latestAnalysis.created_at).toLocaleString()}
                </p>
                <Link to="/app/analyze" className="btn-soft mt-4 inline-flex text-xs">
                  {t('viewAnalysis')}
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState icon={<ScanFace size={22} />} title={t('noData')} detail={t('uploadHint')} />
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold text-ink">{t('latestEnhancement')}</h2>
            <Link to="/app/history" className="text-xs font-semibold text-plum hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          {latestEnhancement?.enhanced_thumbnail ? (
            <div className="flex items-center gap-4">
              <img
                src={latestEnhancement.enhanced_thumbnail}
                alt={t('enhanced')}
                className="h-28 w-24 rounded-xl border border-line object-cover"
              />
              <div>
                <p className="text-sm font-semibold text-ink">{latestEnhancement.mode_label}</p>
                <p className="muted mt-1 text-xs">{latestEnhancement.strength}% · {latestEnhancement.method}</p>
                <Link to="/app/enhance" className="btn-soft mt-3 inline-flex text-xs">
                  {t('viewResult')}
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState icon={<Camera size={22} />} title={t('noData')} detail={t('uploadHint')} />
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={17} className="text-plum" />
            <h2 className="font-display text-lg font-semibold text-ink">{t('navTips')}</h2>
          </div>
          <p className="muted text-xs">
            {latestTips
              ? `${latestTips.morning.length} ${t('morning')} · ${latestTips.night.length} ${t('night')}`
              : t('noData')}
          </p>
          <Link to="/app/tips" className="btn-soft mt-4 inline-flex text-xs">{t('open')}</Link>
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <UtensilsCrossed size={17} className="text-coral" />
            <h2 className="font-display text-lg font-semibold text-ink">{t('navDiet')}</h2>
          </div>
          <p className="muted text-xs">
            {latestDiet
              ? `${latestDiet.weekly_plan.length} ${t('weeklyPlan')} · ${(latestDiet.hydration.target_ml / 1000).toFixed(1)} L`
              : t('noData')}
          </p>
          <Link to="/app/diet" className="btn-soft mt-4 inline-flex text-xs">{t('open')}</Link>
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Bell size={17} className="text-sky" />
            <h2 className="font-display text-lg font-semibold text-ink">{t('navReminders')}</h2>
          </div>
          <p className="muted text-xs">{enabledReminders} {t('active')}</p>
          <Link to="/app/reminders" className="btn-soft mt-4 inline-flex text-xs">{t('open')}</Link>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/app/analyze" className="btn-primary">
          <ScanFace size={16} /> {t('startAnalysis')}
        </Link>
        <Link to="/app/chat" className="btn-soft">
          <Sparkles size={16} /> {t('navChat')}
        </Link>
        {!user && <Button variant="ghost">{t('login')}</Button>}
      </div>
    </div>
  );
}
