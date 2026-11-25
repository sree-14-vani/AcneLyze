import { useEffect, useState } from 'react';
import { Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApp } from '../context/AppContext';
import type { Step } from '../types';
import { Button, Card, EmptyState, ErrorBlock, SectionHeading } from '../components/UI';

export default function RoutinePage() {
  const { t, language } = useI18n();
  const { routine, saveRoutine, latestTips, analyses, pushToast } = useApp();
  const [morning, setMorning] = useState<Step[]>([]);
  const [night, setNight] = useState<Step[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMorning(routine?.morning || []);
    setNight(routine?.night || []);
    setNotes(routine?.notes || []);
  }, [routine]);

  const addStep = (section: 'morning' | 'night') => {
    const step = { title: '', detail: '' };
    if (section === 'morning') setMorning([...morning, step]);
    else setNight([...night, step]);
  };

  const removeStep = (section: 'morning' | 'night', index: number) => {
    if (section === 'morning') setMorning(morning.filter((_, i) => i !== index));
    else setNight(night.filter((_, i) => i !== index));
  };

  const editStep = (section: 'morning' | 'night', index: number, field: keyof Step, value: string) => {
    const setter = section === 'morning' ? setMorning : setNight;
    setter((current) => current.map((step, i) => (i === index ? { ...step, [field]: value } : step)));
  };

  const useSavedTips = async () => {
    if (!latestTips) return;
    setBusy(true);
    setError(null);
    try {
      const plan = latestTips;
      setMorning(plan.morning);
      setNight(plan.night);
      setNotes([...plan.habits, ...plan.precautions]);
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
    } finally {
      setBusy(false);
    }
  };

  const generateFresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const record = analyses[0];
      const plan = await api.tips({
        analysis: record
          ? { overall_score: record.overall_score, concerns: record.concerns, focus_regions: record.focus_regions }
          : null,
        preferences: {
          skin_type: 'combination',
          goals: [],
          sensitivities: [],
          current_routine: notes.join(' '),
        },
        language,
      });
      setMorning(plan.morning);
      setNight(plan.night);
      setNotes([...plan.habits, ...plan.precautions]);
      pushToast(t('planGenerated'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const persist = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveRoutine({
        morning,
        night,
        weekly_focus: routine?.weekly_focus || [],
        notes,
        updated_at: new Date().toISOString(),
      });
      pushToast(t('savedToAccount'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const renderSection = (section: 'morning' | 'night', title: string, steps: Step[]) => (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        <Button variant="ghost" onClick={() => addStep(section)} className="px-2 py-1 text-xs">
          <Plus size={14} /> {t('addStep')}
        </Button>
      </div>
      {steps.length === 0 ? (
        <p className="muted text-sm">{t('noSteps')}</p>
      ) : (
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="rounded-2xl border border-line bg-[#fafbfe] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-plum">
                  {t('step')} {index + 1}
                </span>
                <button
                  onClick={() => removeStep(section, index)}
                  className="rounded-lg p-1 text-muted hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Delete step"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <input
                className="field mt-2"
                value={step.title}
                onChange={(event) => editStep(section, index, 'title', event.target.value)}
                placeholder={t('step')}
              />
              <textarea
                className="field mt-2 min-h-[64px] resize-y"
                value={step.detail}
                onChange={(event) => editStep(section, index, 'detail', event.target.value)}
                placeholder="…"
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <SectionHeading
        eyebrow="Skincare routine"
        title={t('navRoutine')}
        subtitle={t('routineIntro')}
        action={
          <div className="flex flex-wrap gap-2">
            {latestTips && (
              <Button variant="soft" onClick={useSavedTips} loading={busy}>
                {t('useLatest')}
              </Button>
            )}
            <Button variant="soft" onClick={generateFresh} loading={busy}>
              <Sparkles size={16} /> {t('generateTips')}
            </Button>
            <Button onClick={persist} loading={busy} disabled={!morning.length && !night.length}>
              <Save size={16} /> {t('save')}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBlock message={error} />
        </div>
      )}

      {!routine && morning.length === 0 && night.length === 0 && (
        <div className="mb-5">
          <EmptyState icon={<Sparkles size={22} />} title={t('emptyRoutine')} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {renderSection('morning', t('morning'), morning)}
        {renderSection('night', t('night'), night)}
      </div>

      <Card className="mt-5">
        <h2 className="font-display text-lg font-semibold text-ink">{t('habits')} & {t('precautions')}</h2>
        <textarea
          className="field mt-3 min-h-[120px]"
          value={notes.join('\n')}
          onChange={(event) => setNotes(event.target.value.split('\n').filter(Boolean))}
          placeholder={`${t('habits')}\n${t('precautions')}`}
        />
      </Card>
    </div>
  );
}
