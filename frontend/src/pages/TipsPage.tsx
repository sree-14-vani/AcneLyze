import { useMemo, useState } from 'react';
import { CalendarPlus, RefreshCw, Save, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import type { TipPlan } from '../types';
import {
  Button,
  Card,
  Chip,
  Disclaimer,
  EmptyState,
  ErrorBlock,
  SectionHeading,
} from '../components/UI';
import { concernLabel, toVisibleAnalysis } from '../lib/regions';

export default function TipsPage() {
  const { t, language } = useI18n();
  const { latestTips, saveTips, saveRoutine, analyses, profile, preferences, pushToast } = useApp();
  const [plan, setPlan] = useState<TipPlan | null>(latestTips);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestAnalysis = useMemo(() => {
    const record = analyses[0];
    return record ? toVisibleAnalysis(record) : null;
  }, [analyses]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.tips({
        analysis: latestAnalysis,
        preferences: {
          skin_type: profile?.skin_type || 'combination',
          goals: preferences.skin_goals,
          sensitivities: preferences.sensitivities,
          current_routine: preferences.current_routine,
        },
        language,
      });
      setPlan(result);
      pushToast(t('planGenerated'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const persist = async () => {
    if (!plan) return;
    try {
      await saveTips(plan);
      pushToast(t('savedToAccount'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const addToRoutine = async () => {
    if (!plan) return;
    try {
      await saveRoutine({
        morning: plan.morning,
        night: plan.night,
        weekly_focus: plan.focus,
        notes: [...plan.habits, ...plan.precautions],
        updated_at: new Date().toISOString(),
      });
      pushToast(t('savedToAccount'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow="Personalised skincare"
        title={t('navTips')}
        subtitle={t('tipsIntro')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate} loading={loading}>
              {plan ? <RefreshCw size={16} /> : <Sparkles size={16} />}
              {loading ? t('loading') : t('generateTips')}
            </Button>
            {plan && (
              <>
                <Button variant="soft" onClick={persist}>
                  <Save size={16} /> {t('savePlan')}
                </Button>
                <Button variant="soft" onClick={addToRoutine}>
                  <CalendarPlus size={16} /> {t('addToRoutine')}
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBlock message={error} onRetry={generate} />
        </div>
      )}

      {!plan ? (
        <Card>
          <EmptyState
            icon={<Sparkles size={22} />}
            title={t('noData')}
            detail={analyses.length ? t('tipsIntro') : t('noAnalysisYet')}
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Chip tone={plan.generator === 'gemini' ? 'lavender' : 'blue'}>
              {plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
            </Chip>
            {plan.focus.map((item) => (
              <Chip key={item} tone="peach">
                {concernLabel(item, language)}
              </Chip>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {[
              { title: t('morning'), steps: plan.morning, tint: 'from-peach/50 to-white' },
              { title: t('night'), steps: plan.night, tint: 'from-lavender/50 to-white' },
            ].map((section) => (
              <Card key={section.title} className={`bg-gradient-to-br ${section.tint}`}>
                <h2 className="font-display text-xl font-semibold text-ink">{section.title}</h2>
                <ol className="mt-5 space-y-4">
                  {section.steps.map((step, index) => (
                    <li key={`${step.title}-${index}`} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-plum shadow-sm">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{step.title}</p>
                        <p className="muted mt-0.5 text-xs">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>

          {plan.focus_notes.length > 0 && (
            <Card className="mt-5">
              <h2 className="font-display text-lg font-semibold text-ink">{t('focusAreas')}</h2>
              <ul className="mt-3 space-y-2">
                {plan.focus_notes.map((note, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-relaxed text-ink/85">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />
                    {note}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-lg font-semibold text-ink">{t('habits')}</h2>
              <ul className="mt-3 space-y-2.5">
                {plan.habits.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm text-ink/85">
                    <span className="text-plum">•</span> {item}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="font-display text-lg font-semibold text-ink">{t('precautions')}</h2>
              <ul className="mt-3 space-y-2.5">
                {plan.precautions.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm text-ink/85">
                    <span className="text-coral">•</span> {item}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <p className="muted mt-4 text-xs">{plan.notice}</p>
        </>
      )}
      <div className="mt-6">
        <Disclaimer text={t('disclaimer')} />
      </div>
    </div>
  );
}
