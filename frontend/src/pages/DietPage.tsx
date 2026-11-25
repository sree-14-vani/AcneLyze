import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Droplets, Plus, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { toVisibleAnalysis } from '../lib/regions';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import type { DietPlan, DietType } from '../types';
import {
  Button,
  Card,
  Chip,
  Disclaimer,
  EmptyState,
  ErrorBlock,
  SectionHeading,
} from '../components/UI';

const DIET_TYPES: DietType[] = ['vegetarian', 'vegan', 'eggetarian', 'non_vegetarian'];

export default function DietPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { latestDiet, saveDiet, analyses, preferences, updatePreferences, pushToast } = useApp();
  const [plan, setPlan] = useState<DietPlan | null>(latestDiet);
  const [dietType, setDietType] = useState<DietType>(preferences.diet_type);
  const [allergies, setAllergies] = useState<string[]>(preferences.allergies);
  const [allergyInput, setAllergyInput] = useState('');
  const [dislikes, setDislikes] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`acneclear:diet-dislikes:${user?.id || 'local'}`);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [dislikeInput, setDislikeInput] = useState('');
  const [weight, setWeight] = useState(preferences.weight_kg?.toString() || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistDislikes = (values: string[]) => {
    try {
      localStorage.setItem(`acneclear:diet-dislikes:${user?.id || 'local'}`, JSON.stringify(values));
    } catch {
      pushToast(t('error'), 'error');
    }
  };

  const addItem = (
    value: string,
    values: string[],
    setValues: (next: string[]) => void,
    clear: () => void,
  ) => {
    const trimmed = value.trim();
    if (trimmed && !values.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      const next = [...values, trimmed];
      setValues(next);
      return next;
    }
    clear();
    return values;
  };

  const addAllergy = () => {
    addItem(allergyInput, allergies, setAllergies, () => setAllergyInput(''));
    setAllergyInput('');
  };

  const addDislike = () => {
    const next = addItem(dislikeInput, dislikes, setDislikes, () => setDislikeInput(''));
    setDislikeInput('');
    persistDislikes(next);
  };

  const removeAllergy = (value: string) => setAllergies(allergies.filter((item) => item !== value));

  const removeDislike = (value: string) => {
    const next = dislikes.filter((item) => item !== value);
    setDislikes(next);
    persistDislikes(next);
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const analysis = analyses[0] ? toVisibleAnalysis(analyses[0]) : null;
      const result = await api.diet({
        analysis,
        preferences: {
          diet_type: dietType,
          allergies,
          dislikes,
          weight_kg: weight ? Number(weight) : null,
          meals_per_day: 4,
        },
        language: preferences.language,
      });
      setPlan(result);
      await updatePreferences({
        diet_type: dietType,
        allergies,
        weight_kg: weight ? Number(weight) : null,
      });
      pushToast(t('planGenerated'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const persist = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await saveDiet(plan);
      pushToast(t('savedToAccount'), 'success');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow="AcneLyze AI diet planner"
        title={t('navDiet')}
        subtitle={t('dietIntro')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate} loading={loading}>
              {plan ? <RefreshCw size={16} /> : <Sparkles size={16} />}
              {loading ? t('loading') : t('generatePlan')}
            </Button>
            {plan && (
              <Button variant="soft" onClick={persist} loading={saving}>
                <Save size={16} /> {t('savePlan')}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBlock message={error} onRetry={generate} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit">
          <h2 className="font-display text-lg font-semibold text-ink">{t('preferences')}</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              addAllergy();
            }}
          >
            <div>
              <label className="label" htmlFor="diet">
                {t('dietType')}
              </label>
              <select
                id="diet"
                className="field"
                value={dietType}
                onChange={(event) => setDietType(event.target.value as DietType)}
              >
                {DIET_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="allergy">
                {t('foodAllergies')}
              </label>
              <div className="flex gap-2">
                <input
                  id="allergy"
                  className="field"
                  value={allergyInput}
                  onChange={(event) => setAllergyInput(event.target.value)}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === ',') {
                      event.preventDefault();
                      addAllergy();
                    }
                  }}
                  placeholder={t('addAllergy')}
                />
                <button className="btn-soft px-3" type="submit" aria-label={t('foodAllergies')}>
                  <Plus size={16} />
                </button>
              </div>
              {allergies.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allergies.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => removeAllergy(item)}
                      className="pill border-peach bg-peach/50 text-[#a65732]"
                      title="Remove"
                    >
                      {item} <X size={11} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="dislike">
                {t('foodDislikes')}
              </label>
              <div className="flex gap-2">
                <input
                  id="dislike"
                  className="field"
                  value={dislikeInput}
                  onChange={(event) => setDislikeInput(event.target.value)}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === ',' || event.key === 'Enter') {
                      event.preventDefault();
                      addDislike();
                    }
                  }}
                  placeholder="e.g. spinach, mushrooms"
                />
                <button className="btn-soft px-3" type="button" onClick={addDislike} aria-label={t('foodDislikes')}>
                  <Plus size={16} />
                </button>
              </div>
              {dislikes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dislikes.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => removeDislike(item)}
                      className="pill border-line bg-white text-muted"
                      title="Remove"
                    >
                      {item} <X size={11} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="weight">
                {t('weight')}
              </label>
              <input
                id="weight"
                className="field"
                type="number"
                min={25}
                max={250}
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                placeholder="60"
              />
            </div>
            <p className="muted text-xs">{t('privacyNote')}</p>
          </form>
        </Card>

        <div className="space-y-5">
          {!plan ? (
            <Card>
              <EmptyState
                icon={<Sparkles size={22} />}
                title={t('noData')}
                detail={t('dietIntro')}
              />
            </Card>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <Chip tone={plan.generator === 'gemini' ? 'lavender' : 'blue'}>
                  {plan.generator === 'gemini' ? 'Personalised guidance' : 'General guidance'}
                </Chip>
                {plan.avoid.length > 0 && (
                  <Chip tone="peach">
                    {t('avoid')}: {plan.avoid.join(', ')}
                  </Chip>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { title: t('breakfast'), items: plan.breakfast, tint: 'from-peach/50 to-white' },
                  { title: t('lunch'), items: plan.lunch, tint: 'from-powder/60 to-white' },
                  { title: t('snacks'), items: plan.snacks, tint: 'from-lavender/50 to-white' },
                  { title: t('dinner'), items: plan.dinner, tint: 'from-emerald-50 to-white' },
                ].map((section) => (
                  <Card key={section.title} soft className={`bg-gradient-to-br ${section.tint}`}>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-plum">
                      {section.title}
                    </p>
                    <ul className="mt-2.5 space-y-1.5 text-sm text-ink/85">
                      {section.items.map((item, index) => (
                        <li key={index}>• {item}</li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>

              <Card>
                <div className="flex items-center gap-2">
                  <Droplets size={19} className="text-sky" />
                  <h2 className="font-display text-lg font-semibold text-ink">{t('hydration')}</h2>
                </div>
                <p className="mt-2 text-2xl font-semibold text-ink">
                  {(plan.hydration.target_ml / 1000).toFixed(1)} L
                  <span className="ml-2 text-xs font-normal text-muted">{t('hydrationTarget')}</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink/80">
                  {plan.hydration.tips.map((tip, index) => (
                    <li key={index}>• {tip}</li>
                  ))}
                </ul>
                {plan.hydration.note && <p className="muted mt-3 text-xs">{plan.hydration.note}</p>}
              </Card>

              <Card>
                <h2 className="font-display text-lg font-semibold text-ink">{t('weeklyPlan')}</h2>
                <div className="scrollbar-thin mt-4 overflow-x-auto">
                  <table className="w-full min-w-[660px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-muted">
                        <th className="py-2 pr-3 font-semibold"> </th>
                        <th className="py-2 pr-3 font-semibold">{t('breakfast')}</th>
                        <th className="py-2 pr-3 font-semibold">{t('lunch')}</th>
                        <th className="py-2 pr-3 font-semibold">{t('snacks')}</th>
                        <th className="py-2 font-semibold">{t('dinner')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.weekly_plan.map((day, index) => (
                        <tr key={`${day.day}-${index}`} className="border-b border-line/70 align-top">
                          <td className="py-3 pr-3 font-semibold text-ink">{day.day}</td>
                          <td className="py-3 pr-3 text-muted">{day.breakfast}</td>
                          <td className="py-3 pr-3 text-muted">{day.lunch}</td>
                          <td className="py-3 pr-3 text-muted">{day.snacks}</td>
                          <td className="py-3 text-muted">{day.dinner}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {plan.notes.length > 0 && (
                <Card soft>
                  {plan.notes.map((note, index) => (
                    <p key={index} className="muted text-xs">
                      • {note}
                    </p>
                  ))}
                  <p className="muted mt-3 text-xs">{plan.notice}</p>
                </Card>
              )}
            </>
          )}
          <Disclaimer text={t('disclaimer')} />
        </div>
      </div>
    </div>
  );
}
