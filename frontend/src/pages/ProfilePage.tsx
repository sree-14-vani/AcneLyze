import { useEffect, useState } from 'react';
import { Globe2, LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useI18n } from '../lib/i18n';
import { LANGUAGE_LABELS } from '../lib/regions';
import type { DietType, Language } from '../types';
import { Button, Card, Chip, ErrorBlock, SectionHeading } from '../components/UI';

const DIET_TYPES: DietType[] = ['vegetarian', 'vegan', 'eggetarian', 'non_vegetarian'];

export default function ProfilePage() {
  const { t } = useI18n();
  const { user, mode, updateName } = useAuth();
  const { profile, preferences, apiConfig, updateProfile, updatePreferences, pushToast } = useApp();
  const [name, setName] = useState(profile?.full_name || user?.name || '');
  const [skinType, setSkinType] = useState(profile?.skin_type || 'combination');
  const [language, setLanguage] = useState<Language>(preferences.language);
  const [dietType, setDietType] = useState<DietType>(preferences.diet_type);
  const [goals, setGoals] = useState(preferences.skin_goals.join(', '));
  const [allergies, setAllergies] = useState(preferences.allergies.join(', '));
  const [sensitivities, setSensitivities] = useState(preferences.sensitivities.join(', '));
  const [routine, setRoutine] = useState(preferences.current_routine);
  const [weight, setWeight] = useState(preferences.weight_kg?.toString() || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.full_name || user?.name || '');
    setSkinType(profile?.skin_type || 'combination');
    setLanguage(preferences.language);
    setDietType(preferences.diet_type);
    setGoals(preferences.skin_goals.join(', '));
    setAllergies(preferences.allergies.join(', '));
    setSensitivities(preferences.sensitivities.join(', '));
    setRoutine(preferences.current_routine);
    setWeight(preferences.weight_kg?.toString() || '');
  }, [profile, user, preferences]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ full_name: name.trim(), skin_type: skinType });
      if (name.trim() !== user?.name) await updateName(name.trim());
      await updatePreferences({
        language,
        diet_type: dietType,
        skin_goals: goals.split(',').map((item) => item.trim()).filter(Boolean),
        allergies: allergies.split(',').map((item) => item.trim()).filter(Boolean),
        sensitivities: sensitivities.split(',').map((item) => item.trim()).filter(Boolean),
        current_routine: routine.trim(),
        weight_kg: weight ? Number(weight) : null,
      });
      pushToast(t('savedToAccount'), 'success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading
        eyebrow={t('account')}
        title={t('navProfile')}
        subtitle={t('preferences')}
        action={
          <Button onClick={save} loading={busy}>
            <Save size={16} /> {t('save')}
          </Button>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorBlock message={error} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card>
          <h2 className="font-display text-xl font-semibold text-ink">{t('personalDetails')}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="fullName">{t('fullName')}</label>
              <input id="fullName" className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">{t('email')}</label>
              <div className="field flex items-center gap-2 bg-[#fafbfe] text-muted">
                <LockKeyhole size={14} /> {user?.email}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="skinType">{t('skinType')}</label>
              <select id="skinType" className="field" value={skinType} onChange={(event) => setSkinType(event.target.value)}>
                {['dry', 'oily', 'combination', 'normal', 'sensitive', 'unsure'].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="language">{t('language')}</label>
              <select id="language" className="field" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
                  <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="goals">{t('goals')}</label>
              <input
                id="goals"
                className="field"
                value={goals}
                onChange={(event) => setGoals(event.target.value)}
                placeholder="reduce redness, minimise pores"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="allergies">{t('foodAllergies')}</label>
              <input
                id="allergies"
                className="field"
                value={allergies}
                onChange={(event) => setAllergies(event.target.value)}
                placeholder="peanut, gluten"
              />
              <p className="muted mt-1 text-[11px]">{t('allergyScope')}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="sensitivities">{t('sensitivities')}</label>
              <input
                id="sensitivities"
                className="field"
                value={sensitivities}
                onChange={(event) => setSensitivities(event.target.value)}
                placeholder="fragrance, retinol"
              />
              <p className="muted mt-1 text-[11px]">{t('sensitivityScope')}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="currentRoutine">{t('currentRoutine')}</label>
              <textarea
                id="currentRoutine"
                className="field min-h-[90px]"
                value={routine}
                onChange={(event) => setRoutine(event.target.value)}
              />
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="flex items-center gap-2">
              <Globe2 size={18} className="text-plum" />
              <h2 className="font-display text-lg font-semibold text-ink">{t('preferences')}</h2>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="dietType">{t('dietType')}</label>
                <select id="dietType" className="field" value={dietType} onChange={(event) => setDietType(event.target.value as DietType)}>
                  {DIET_TYPES.map((type) => (
                    <option key={type} value={type}>{type.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="weight">{t('weight')}</label>
                <input
                  id="weight"
                  type="number"
                  min={25}
                  max={250}
                  className="field"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card soft>
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-sky" />
              <h2 className="font-display text-lg font-semibold text-ink">{t('privacy')}</h2>
            </div>
            <p className="muted mt-2 text-xs">{t('privacyNote')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip tone={mode === 'demo' ? 'peach' : 'green'}>
                {mode === 'demo' ? t('demoMode') : 'Secure account'}
              </Chip>
              <Chip tone={(apiConfig?.features.chat_available ?? apiConfig?.features.gemini_chat) ? 'lavender' : 'neutral'}>
                {(apiConfig?.features.chat_available ?? apiConfig?.features.gemini_chat) ? 'AI assistant available' : 'AI assistant unavailable'}
              </Chip>
              <Chip tone={apiConfig?.features.gfpgan ? 'green' : 'blue'}>
                {apiConfig?.features.gfpgan ? t('gfpganOn') : t('gfpganOff')}
              </Chip>
            </div>
            {!apiConfig?.features.gfpgan && (
              <p className="mt-3 text-xs text-rose-700">{t('modelNote')}</p>
            )}
            {mode === 'demo' && <p className="muted mt-3 text-xs">{t('demoNotice')}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
